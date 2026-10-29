import { cleanLabel, type Account } from "./accounts";
import { MANUAL_KIND_LABELS, validateJournal, type ManualKind } from "./ledger";
import { parseCents } from "./money";
import { addDays, parseDate } from "./dates";

type Form = Record<string, string | undefined>;
export interface JournalDraft { date: string; kind: ManualKind; description: string; lines: { account_id: number; debit_cents: number; credit_cents: number }[] }
type Parsed = { ok: true; value: JournalDraft } | { ok: false; errors: string[] };

const byKey = (accounts: readonly Account[], key: string) => accounts.find((a) => a.system_key === key && a.active);
const MAX_CENTS = 99_999_999_999;

function commonParts(f: Form, today: string): { date: string | null; description: string | null; errors: string[] } {
  const errors: string[] = [];
  const date = parseDate(f.entry_date);
  if (!date) errors.push("Date: use a real date.");
  else if (date > addDays(today, 366)) errors.push("Date: more than a year ahead.");
  const raw = (f.description ?? "").trim();
  const description = raw === "" ? "" : cleanLabel(raw, 120);
  if (description === null) errors.push("Description: letters, numbers, spaces and . , & ' - # / ( ) : only, up to 120 characters. No personal details.");
  return { date, description, errors };
}

/** Owner contribution, owner draw and Square payout: one amount, two fixed accounts, so these can never be entered unbalanced. */
export function parseSimpleEntry(kind: "owner_contribution" | "owner_draw" | "transfer", f: Form, accounts: readonly Account[], today: string): Parsed {
  const { date, description, errors } = commonParts(f, today);
  const cents = parseCents(f.amount);
  if (cents === null || cents <= 0 || cents > MAX_CENTS) errors.push("Amount: a positive dollar amount like 250.00.");
  const cash = byKey(accounts, "cash_bank"), sq = byKey(accounts, "square_balance"), contrib = byKey(accounts, "owner_contributions"), draws = byKey(accounts, "owner_draws");
  if (!cash || !sq || !contrib || !draws) errors.push("The standard accounts are missing or inactive. Check the Chart of Accounts.");
  if (errors.length || !date || cents === null || !cash || !sq || !contrib || !draws) return { ok: false, errors };
  const lines = kind === "owner_contribution" ? [{ account_id: cash.id, debit_cents: cents, credit_cents: 0 }, { account_id: contrib.id, debit_cents: 0, credit_cents: cents }]
    : kind === "owner_draw" ? [{ account_id: draws.id, debit_cents: cents, credit_cents: 0 }, { account_id: cash.id, debit_cents: 0, credit_cents: cents }]
    : [{ account_id: cash.id, debit_cents: cents, credit_cents: 0 }, { account_id: sq.id, debit_cents: 0, credit_cents: cents }];
  return { ok: true, value: { date, kind, description: description || MANUAL_KIND_LABELS[kind], lines } };
}

/** General manual or adjusting entry: up to 6 lines (a1/d1/c1 ...). Blank lines are skipped; the entry must balance. */
export function parseJournalForm(f: Form, accounts: readonly Account[], today: string): Parsed {
  const { date, description, errors } = commonParts(f, today);
  const kind: ManualKind = f.kind === "adjusting" ? "adjusting" : f.kind === "opening_balance" ? "opening_balance" : "manual";
  if (!description) errors.push("Description: say what this entry is for.");
  const lines: JournalDraft["lines"] = [];
  for (let i = 1; i <= 6; i++) {
    const acct = f[`a${i}`], d = (f[`d${i}`] ?? "").trim(), c = (f[`c${i}`] ?? "").trim();
    if (!acct && !d && !c) continue;
    const a = accounts.find((x) => String(x.id) === acct && x.active);
    const debit = d === "" ? 0 : parseCents(d), credit = c === "" ? 0 : parseCents(c);
    if (!a) { errors.push(`Line ${i}: choose an active account.`); continue; }
    if (debit === null || credit === null || debit > MAX_CENTS || credit > MAX_CENTS) { errors.push(`Line ${i}: amounts like 125.00.`); continue; }
    lines.push({ account_id: a.id, debit_cents: debit, credit_cents: credit });
  }
  if (!errors.length) errors.push(...validateJournal(lines.map((l) => ({ accountId: l.account_id, debit: l.debit_cents, credit: l.credit_cents }))));
  if (errors.length || !date || !description) return { ok: false, errors };
  return { ok: true, value: { date, kind, description, lines } };
}
