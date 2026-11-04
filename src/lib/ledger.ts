import { type Account } from "./accounts";
import { CATEGORY_LABELS, type Expense } from "./expenses";
import { SOURCE_LABELS, type IncomeEntry } from "./income";
import { REASON_LABELS, replaySteps, type Movement } from "./inventory";
import type { Payment } from "./taxforms";

/*
 * The ledger (cash basis). Your own records stay the single source of truth; the ledger is calculated from them every time, so nothing
 * is copied and nothing can drift or be counted twice. Every record becomes ONE balanced journal entry (debits = credits):
 *
 *   Income        Dr Square balance (or Cash and bank) = revenue + tips - processing fee,  Dr Payment processing fees,
 *                 Cr Service revenue (or the revenue account you chose),  Cr Tips received.
 *   Expense       Dr the expense account (category default, or the account you chose),  Cr Cash and bank.
 *   Inventory     opening stock: Dr Inventory, Cr Opening balance equity.   purchase: Dr Inventory, Cr Cash and bank (an asset, not an expense).
 *                 use: Dr Medical supplies consumed (or the item's cost account), Cr Inventory.   adjustments and write-offs: Inventory <-> write-offs.
 *                 Dollar values come from the existing weighted-average replay, so the inventory account always equals the inventory report.
 *   Tax payment   Dr Owner draws, Cr Cash and bank (an estimated tax payment is personal, so it is an owner draw, never a business expense).
 *   Manual entry  owner contributions, owner draws, Square payouts and so on, saved as balanced entries (see journal validation below).
 *
 * Mileage is a tax-deduction estimate, not money spent, so it is not posted. Refunds flagged at import are not income entries, so they are
 * not in the ledger either (the reports say so). No opening bank or Square balances exist yet, so balances are "from recorded transactions".
 */
export type EntryKind = "income" | "expense" | "inventory" | "tax_payment" | "manual";
export const ENTRY_KIND_LABELS: Record<EntryKind, string> = { income: "Income", expense: "Expense", inventory: "Inventory", tax_payment: "Tax payment", manual: "Manual entry" };

export interface Line { entryKey: string; date: string; accountId: number; debit: number; credit: number; text: string }
export interface Entry { key: string; date: string; kind: EntryKind; text: string; href: string | null; lines: Line[] }

export const MANUAL_KINDS = [
  { id: "owner_contribution", label: "Owner contribution" },
  { id: "owner_draw", label: "Owner draw" },
  { id: "transfer", label: "Square payout / transfer" },
  { id: "opening_balance", label: "Opening balance" },
  { id: "manual", label: "Manual journal entry" },
  { id: "adjusting", label: "Adjusting entry" },
  { id: "reversal", label: "Reversal" },
] as const;
export type ManualKind = (typeof MANUAL_KINDS)[number]["id"];
export const MANUAL_KIND_LABELS: Record<string, string> = Object.fromEntries(MANUAL_KINDS.map((k) => [k.id, k.label]));

export interface ManualEntry { id: number; entry_date: string; kind: ManualKind; description: string; reverses_id: number | null; lines: { account_id: number; debit_cents: number; credit_cents: number }[] }

export interface LedgerInput {
  accounts: readonly Account[];
  /** Expense category -> account id, only for categories you re-mapped. Others use the default account for the category. */
  categoryAccounts?: Readonly<Record<string, number>>;
  expenseAccounts?: Readonly<Record<number, number>>; // expense id -> account id (your classification)
  incomeAccounts?: Readonly<Record<number, number>>; // income entry id -> revenue account id
  itemAccounts?: Readonly<Record<number, number>>; // inventory item id -> cost-of-services account for its consumption
  income: readonly IncomeEntry[];
  expenses: readonly Expense[];
  movements: readonly Movement[];
  items: readonly { id: number; label: string }[];
  payments: readonly Payment[];
  manual: readonly ManualEntry[];
}
export interface Ledger { entries: Entry[]; lines: Line[]; problems: string[] }

/** Is this a valid journal entry? At least two lines, each on one side only, whole positive cents, and debits exactly equal credits. */
export function validateJournal(lines: readonly { accountId: number; debit: number; credit: number }[]): string[] {
  const errors: string[] = [];
  if (lines.length < 2) errors.push("A journal entry needs at least two lines.");
  let debits = 0, credits = 0;
  for (const [i, l] of lines.entries()) {
    const ok = Number.isSafeInteger(l.debit) && Number.isSafeInteger(l.credit) && l.debit >= 0 && l.credit >= 0;
    if (!ok) { errors.push(`Line ${i + 1}: amounts must be whole cents, zero or more.`); continue; }
    if ((l.debit > 0) === (l.credit > 0)) errors.push(`Line ${i + 1}: enter either a debit or a credit, not both and not neither.`);
    debits += l.debit; credits += l.credit;
  }
  if (debits !== credits) errors.push(`Debits (${(debits / 100).toFixed(2)}) and credits (${(credits / 100).toFixed(2)}) must be equal.`);
  if (debits === 0 && lines.length >= 2 && !errors.length) errors.push("The entry has no amount.");
  return errors;
}

export function buildLedger(input: LedgerInput): Ledger {
  const problems: string[] = [];
  const byKey = new Map<string, Account>();
  for (const a of input.accounts) if (a.system_key) byKey.set(a.system_key, a);
  const need = (key: string): number | null => {
    const a = byKey.get(key);
    if (!a) { const msg = `An account the automatic postings need ("${key}") is missing. Press Update on the home page.`; if (!problems.includes(msg)) problems.push(msg); return null; }
    return a.id;
  };
  const entries: Entry[] = [];
  const add = (key: string, date: string, kind: EntryKind, text: string, href: string | null, raw: { accountId: number | null; debit?: number; credit?: number }[]) => {
    if (raw.some((l) => l.accountId === null)) return; // a missing system account was already reported
    const lines: Line[] = raw.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0).map((l) => ({ entryKey: key, date, accountId: l.accountId as number, debit: l.debit ?? 0, credit: l.credit ?? 0, text }));
    const bad = validateJournal(lines);
    if (bad.length) { problems.push(`${key} did not balance and was left out: ${bad.join(" ")}`); return; }
    entries.push({ key, date, kind, text, href, lines });
  };

  const cash = need("cash_bank");
  for (const i of input.income) {
    const deposit = i.source === "square" ? need("square_balance") : cash;
    const revenue = input.incomeAccounts?.[i.id] ?? need("service_revenue");
    const net = i.gross_cents + i.tip_cents - i.fee_cents;
    const raw: { accountId: number | null; debit?: number; credit?: number }[] = [{ accountId: deposit, debit: net }];
    if (i.fee_cents > 0) raw.push({ accountId: need("processing_fees"), debit: i.fee_cents });
    if (i.gross_cents > 0) raw.push({ accountId: revenue, credit: i.gross_cents });
    if (i.tip_cents > 0) raw.push({ accountId: need("tips"), credit: i.tip_cents });
    add(`income:${i.id}`, i.occurred_on, "income", `${SOURCE_LABELS[i.source] ?? i.source} income`, "/income", raw);
  }

  for (const e of input.expenses) {
    const account = input.expenseAccounts?.[e.id] ?? input.categoryAccounts?.[e.category] ?? need(`cat:${e.category}`);
    add(`expense:${e.id}`, e.spent_on, "expense", `${CATEGORY_LABELS[e.category] ?? e.category}${e.vendor ? `: ${e.vendor}` : ""}`, "/expenses", [{ accountId: account, debit: e.amount_cents }, { accountId: cash, credit: e.amount_cents }]);
  }

  const labelOf = new Map(input.items.map((it) => [it.id, it.label]));
  const itemIds = [...new Set(input.movements.map((m) => m.item_id))].sort((a, b) => a - b);
  for (const itemId of itemIds) {
    const r = replaySteps(input.movements.filter((m) => m.item_id === itemId));
    const name = labelOf.get(itemId) ?? `item ${itemId}`;
    if (!r.ok) { problems.push(`Inventory for ${name} cannot be valued: ${r.error} Its movements are left out of the ledger.`); continue; }
    for (const s of r.steps) {
      const d = s.valueDelta, m = s.m, href = `/inventory/${itemId}`, key = `inventory:${m.id}`;
      if (d === 0) continue;
      const inv = need("inventory");
      if (m.kind === "opening") add(key, m.moved_on, "inventory", `Opening stock: ${name}`, href, [{ accountId: inv, debit: d }, { accountId: need("opening_equity"), credit: d }]);
      else if (m.kind === "purchase") add(key, m.moved_on, "inventory", `Inventory purchase: ${name}`, href, [{ accountId: inv, debit: d }, { accountId: cash, credit: d }]);
      else if (m.kind === "use") add(key, m.moved_on, "inventory", `Supplies used: ${name}`, href, [{ accountId: input.itemAccounts?.[itemId] ?? need("supplies_consumed"), debit: -d }, { accountId: inv, credit: -d }]);
      else if (m.kind === "adjust_up") add(key, m.moved_on, "inventory", `Count adjustment (add): ${name}`, href, [{ accountId: inv, debit: d }, { accountId: need("inventory_adjust"), credit: d }]);
      else add(key, m.moved_on, "inventory", `${m.reason === "expired" ? "Expired stock written off" : m.reason === "count_correction" ? "Count adjustment (remove)" : `Stock removed (${REASON_LABELS[m.reason ?? "other"]?.toLowerCase()})`}: ${name}`, href, [{ accountId: need("inventory_adjust"), debit: -d }, { accountId: inv, credit: -d }]);
    }
  }

  for (const p of input.payments) {
    add(`taxpay:${p.id}`, p.paid_on, "tax_payment", "Estimated tax payment (personal, recorded as an owner draw)", "/taxes/payments", [{ accountId: need("owner_draws"), debit: p.amount_cents }, { accountId: cash, credit: p.amount_cents }]);
  }

  for (const m of input.manual) {
    add(`manual:${m.id}`, m.entry_date, "manual", m.description, `/accounting/transactions#manual-${m.id}`, m.lines.map((l) => ({ accountId: l.account_id, debit: l.debit_cents, credit: l.credit_cents })));
  }

  const dup = new Set<string>();
  for (const e of entries) { if (dup.has(e.key)) problems.push(`Duplicate ledger entry ${e.key}.`); dup.add(e.key); }
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { entries, lines: entries.flatMap((e) => e.lines), problems };
}

/* ---------- balances and the general ledger ---------- */

const natural = (a: Account, debit: number, credit: number) => (a.normal === "debit" ? debit - credit : credit - debit);

export interface AccountActivity { account: Account; opening: number; debits: number; credits: number; ending: number }

/** For each account: balance before `from`, debits and credits inside the range, and the balance at the end. Balances are shown on the account's normal side. */
export function accountActivity(lines: readonly Line[], accounts: readonly Account[], range: { from: string; to: string }): AccountActivity[] {
  const by = new Map<number, { od: number; oc: number; d: number; c: number }>();
  for (const l of lines) {
    if (l.date > range.to) continue;
    const s = by.get(l.accountId) ?? { od: 0, oc: 0, d: 0, c: 0 };
    if (l.date < range.from) { s.od += l.debit; s.oc += l.credit; } else { s.d += l.debit; s.c += l.credit; }
    by.set(l.accountId, s);
  }
  return accounts.map((account) => {
    const s = by.get(account.id) ?? { od: 0, oc: 0, d: 0, c: 0 };
    return { account, opening: natural(account, s.od, s.oc), debits: s.d, credits: s.c, ending: natural(account, s.od + s.d, s.oc + s.c) };
  });
}

export interface GlRow { line: Line; entry: Entry | undefined; balance: number }
export interface GlAccount { account: Account; opening: number; rows: GlRow[]; debits: number; credits: number; ending: number }

/** General ledger for one account: beginning balance, each transaction with a running balance, ending balance. */
export function generalLedger(ledger: Ledger, account: Account, range: { from: string; to: string }): GlAccount {
  const entryByKey = new Map(ledger.entries.map((e) => [e.key, e]));
  let od = 0, oc = 0, d = 0, c = 0;
  const rows: GlRow[] = [];
  let running = 0;
  for (const l of ledger.lines) {
    if (l.accountId !== account.id || l.date > range.to) continue;
    if (l.date < range.from) { od += l.debit; oc += l.credit; continue; }
    if (rows.length === 0) running = natural(account, od, oc);
    running += natural(account, l.debit, l.credit);
    d += l.debit; c += l.credit;
    rows.push({ line: l, entry: entryByKey.get(l.entryKey), balance: running });
  }
  const opening = natural(account, od, oc);
  return { account, opening, rows, debits: d, credits: c, ending: natural(account, od + d, oc + c) };
}

/* ---------- checks: the ledger must reconcile with the records it came from ---------- */

export interface Check { ok: boolean; label: string; detail: string }

export function ledgerChecks(ledger: Ledger, input: LedgerInput): Check[] {
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));
  const sumBy = (pred: (a: Account) => boolean, kinds: EntryKind[], side: "debit" | "credit") =>
    ledger.entries.filter((e) => kinds.includes(e.kind)).flatMap((e) => e.lines).filter((l) => { const a = accountById.get(l.accountId); return a !== undefined && pred(a); }).reduce((t, l) => t + l[side], 0);
  const checks: Check[] = [];
  const debits = ledger.lines.reduce((t, l) => t + l.debit, 0), credits = ledger.lines.reduce((t, l) => t + l.credit, 0);
  checks.push({ ok: debits === credits && ledger.entries.every((e) => e.lines.reduce((t, l) => t + l.debit - l.credit, 0) === 0), label: "Every entry balances", detail: `${ledger.entries.length} entries, total debits equal total credits.` });
  checks.push({ ok: new Set(ledger.entries.map((e) => e.key)).size === ledger.entries.length, label: "No duplicate entries", detail: "Each income, expense, inventory and payment record is posted once." });
  const rev = sumBy((a) => a.type === "revenue", ["income"], "credit"), gross = input.income.reduce((t, i) => t + i.gross_cents, 0);
  checks.push({ ok: rev === gross, label: "Revenue matches income entries", detail: `Ledger revenue ${(rev / 100).toFixed(2)} and income entries ${(gross / 100).toFixed(2)}.` });
  const tips = sumBy((a) => a.system_key === "tips", ["income"], "credit"), tipSum = input.income.reduce((t, i) => t + i.tip_cents, 0);
  checks.push({ ok: tips === tipSum, label: "Tips match income entries", detail: `Ledger tips ${(tips / 100).toFixed(2)} and income entries ${(tipSum / 100).toFixed(2)}.` });
  const fees = sumBy((a) => a.system_key === "processing_fees", ["income"], "debit"), feeSum = input.income.reduce((t, i) => t + i.fee_cents, 0);
  checks.push({ ok: fees === feeSum, label: "Processing fees match income entries", detail: `Ledger fees ${(fees / 100).toFixed(2)} and income entries ${(feeSum / 100).toFixed(2)}. Fees are posted once, from the payment.` });
  const exp = sumBy((a) => a.type !== "asset" && a.type !== "liability" && a.type !== "equity", ["expense"], "debit"), expSum = input.expenses.reduce((t, e) => t + e.amount_cents, 0);
  checks.push({ ok: exp === expSum, label: "Expenses match expense entries", detail: `Ledger ${(exp / 100).toFixed(2)} and expense entries ${(expSum / 100).toFixed(2)}.` });
  const invAcc = input.accounts.find((a) => a.system_key === "inventory");
  if (invAcc) {
    const ledgerInv = ledger.lines.filter((l) => l.accountId === invAcc.id).reduce((t, l) => t + l.debit - l.credit, 0);
    let reportInv = 0, replayable = true;
    for (const id of new Set(input.movements.map((m) => m.item_id))) { const r = replaySteps(input.movements.filter((m) => m.item_id === id)); if (r.ok) reportInv += r.steps[r.steps.length - 1]?.valueCents ?? 0; else replayable = false; }
    checks.push({ ok: replayable && ledgerInv === reportInv, label: "Inventory account equals the inventory report", detail: replayable ? `Ledger ${(ledgerInv / 100).toFixed(2)} and inventory value ${(reportInv / 100).toFixed(2)}.` : "An item cannot be valued." });
  }
  for (const p of ledger.problems) checks.push({ ok: false, label: "Problem", detail: p });
  return checks;
}

/** Things that look like the same cost entered twice. Only warnings: you decide. */
export function doubleCountWarnings(input: LedgerInput): string[] {
  const out: string[] = [];
  const itemName = new Map(input.items.map((i) => [i.id, i.label]));
  const purchases = new Map<string, string>();
  for (const id of new Set(input.movements.map((m) => m.item_id))) {
    const r = replaySteps(input.movements.filter((m) => m.item_id === id));
    if (r.ok) for (const s of r.steps) if (s.m.kind === "purchase" && s.valueDelta > 0) purchases.set(`${s.m.moved_on}|${s.valueDelta}`, itemName.get(id) ?? `item ${id}`);
  }
  for (const e of input.expenses) {
    const hit = purchases.get(`${e.spent_on}|${e.amount_cents}`);
    if (hit) out.push(`Expense on ${e.spent_on} (${(e.amount_cents / 100).toFixed(2)}) has the same date and amount as an inventory purchase of ${hit}. If it is the same purchase, delete one: inventory purchases are already recorded as an asset.`);
    if (e.vendor && /square/i.test(e.vendor)) out.push(`Expense on ${e.spent_on} names Square. Processing fees come from each Square payment already, so adding them as an expense would count them twice.`);
  }
  return out;
}
