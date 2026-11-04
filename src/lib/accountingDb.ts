import { DEFAULT_ACCOUNTS, validateAccountForm, deactivateProblem, type Account, type AccountForm, type AccountType, type Side } from "./accounts";
import { validateJournal, type LedgerInput, type ManualEntry, type ManualKind } from "./ledger";
import { audit, listExpensesAll, listIncomeAll, listItems, listMovements, sql } from "./db";
import type { Payment, PaymentKind } from "./taxforms";

/*
 * Database side of the accounting area. Only the chart of accounts, your classifications and manual journal entries are stored here;
 * every other number is calculated from your income, expenses, inventory and tax payment records (see ledger.ts).
 */
const ALL_FROM = "2000-01-01", ALL_TO = "2100-12-31";

const toAccount = (r: Record<string, unknown>): Account => ({ id: Number(r.id), number: Number(r.number), label: r.label as string, type: r.type as AccountType, normal: r.normal as Side, system_key: (r.system_key as string | null) ?? null, active: Boolean(r.active) });

/** Adds the starting chart, once, only while the table is empty (so a renamed or renumbered account is never recreated). */
export async function seedAccounts(): Promise<void> {
  const values = DEFAULT_ACCOUNTS.map((_, i) => `($${i * 5 + 1}::int, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5}::text)`).join(", ");
  const params = DEFAULT_ACCOUNTS.flatMap((a) => [a.number, a.label, a.type, a.normal, a.key]);
  await sql().query(`INSERT INTO accounts (number, label, type, normal, system_key) SELECT v.number, v.label, v.type, v.normal, v.system_key FROM (VALUES ${values}) AS v(number, label, type, normal, system_key) WHERE NOT EXISTS (SELECT 1 FROM accounts)`, params);
}

export async function listAccounts(): Promise<Account[]> {
  let rows = (await sql()`SELECT id, number, label, type, normal, system_key, active FROM accounts ORDER BY number`) as Record<string, unknown>[];
  if (!rows.length) { await seedAccounts(); rows = (await sql()`SELECT id, number, label, type, normal, system_key, active FROM accounts ORDER BY number`) as Record<string, unknown>[]; }
  return rows.map(toAccount);
}

export async function accountHasHistory(id: number): Promise<boolean> {
  const r = (await sql()`SELECT (EXISTS (SELECT 1 FROM journal_lines WHERE account_id = ${id}) OR EXISTS (SELECT 1 FROM expense_accounts WHERE account_id = ${id}) OR EXISTS (SELECT 1 FROM income_accounts WHERE account_id = ${id})
    OR EXISTS (SELECT 1 FROM expense_category_accounts WHERE account_id = ${id}) OR EXISTS (SELECT 1 FROM inventory_item_accounts WHERE account_id = ${id})) AS used`)[0];
  return Boolean(r?.used);
}

export async function saveAccount(form: AccountForm, id?: number): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const all = await listAccounts();
  const editing = id === undefined ? undefined : all.find((a) => a.id === id);
  if (id !== undefined && !editing) return { ok: false, errors: ["That account was not found."] };
  const v = validateAccountForm(form, all, editing, editing ? await accountHasHistory(editing.id) : false);
  if (!v.ok) return v;
  const { number, label, type, normal } = v.value;
  if (editing) {
    await sql()`UPDATE accounts SET number = ${number}, label = ${label}, type = ${type}, normal = ${normal} WHERE id = ${editing.id}`;
    await audit("account_edit", { id: editing.id, number, label });
  } else {
    await sql()`INSERT INTO accounts (number, label, type, normal) VALUES (${number}, ${label}, ${type}, ${normal})`;
    await audit("account_add", { number, label, type });
  }
  return { ok: true };
}

export async function setAccountActive(id: number, active: boolean): Promise<string | null> {
  const a = (await listAccounts()).find((x) => x.id === id);
  if (!a) return "That account was not found.";
  if (!active) { const p = deactivateProblem(a); if (p) return p; }
  await sql()`UPDATE accounts SET active = ${active} WHERE id = ${id}`;
  await audit("account_active", { id, number: a.number, active });
  return null;
}

/* ---- classification: which account a record posts to ---- */
export interface Mappings { categoryAccounts: Record<string, number>; expenseAccounts: Record<number, number>; incomeAccounts: Record<number, number>; itemAccounts: Record<number, number> }

export async function getMappings(): Promise<Mappings> {
  const [c, e, i, it] = await Promise.all([
    sql()`SELECT category, account_id FROM expense_category_accounts`, sql()`SELECT expense_id, account_id FROM expense_accounts`,
    sql()`SELECT income_id, account_id FROM income_accounts`, sql()`SELECT item_id, account_id FROM inventory_item_accounts`,
  ]);
  return {
    categoryAccounts: Object.fromEntries(c.map((r) => [r.category as string, Number(r.account_id)])),
    expenseAccounts: Object.fromEntries(e.map((r) => [Number(r.expense_id), Number(r.account_id)])),
    incomeAccounts: Object.fromEntries(i.map((r) => [Number(r.income_id), Number(r.account_id)])),
    itemAccounts: Object.fromEntries(it.map((r) => [Number(r.item_id), Number(r.account_id)])),
  };
}

type MapTable = "category" | "expense" | "income" | "item";
/** Sets (or clears, when accountId is null) the account for a category, expense, income entry or inventory item. Past entries are not rewritten; the ledger is recalculated. */
export async function setMapping(table: MapTable, key: string | number, accountId: number | null): Promise<void> {
  const q = sql();
  if (table === "category") {
    if (accountId === null) await q`DELETE FROM expense_category_accounts WHERE category = ${String(key)}`;
    else await q`INSERT INTO expense_category_accounts (category, account_id) VALUES (${String(key)}, ${accountId}) ON CONFLICT (category) DO UPDATE SET account_id = EXCLUDED.account_id`;
  } else if (table === "expense") {
    if (accountId === null) await q`DELETE FROM expense_accounts WHERE expense_id = ${Number(key)}`;
    else await q`INSERT INTO expense_accounts (expense_id, account_id) VALUES (${Number(key)}, ${accountId}) ON CONFLICT (expense_id) DO UPDATE SET account_id = EXCLUDED.account_id`;
  } else if (table === "income") {
    if (accountId === null) await q`DELETE FROM income_accounts WHERE income_id = ${Number(key)}`;
    else await q`INSERT INTO income_accounts (income_id, account_id) VALUES (${Number(key)}, ${accountId}) ON CONFLICT (income_id) DO UPDATE SET account_id = EXCLUDED.account_id`;
  } else {
    if (accountId === null) await q`DELETE FROM inventory_item_accounts WHERE item_id = ${Number(key)}`;
    else await q`INSERT INTO inventory_item_accounts (item_id, account_id) VALUES (${Number(key)}, ${accountId}) ON CONFLICT (item_id) DO UPDATE SET account_id = EXCLUDED.account_id`;
  }
  await audit("classify", { table, key, account_id: accountId });
}

/* ---- manual journal entries: append-only, balanced, corrected by reversal ---- */
export async function listManualEntries(): Promise<ManualEntry[]> {
  const [es, ls] = await Promise.all([
    sql()`SELECT id, to_char(entry_date, 'YYYY-MM-DD') AS entry_date, kind, description, reverses_id FROM journal_entries ORDER BY entry_date, id`,
    sql()`SELECT entry_id, account_id, debit_cents, credit_cents FROM journal_lines ORDER BY id`,
  ]);
  return es.map((e) => ({
    id: Number(e.id), entry_date: e.entry_date as string, kind: e.kind as ManualKind, description: e.description as string, reverses_id: e.reverses_id === null ? null : Number(e.reverses_id),
    lines: ls.filter((l) => Number(l.entry_id) === Number(e.id)).map((l) => ({ account_id: Number(l.account_id), debit_cents: Number(l.debit_cents), credit_cents: Number(l.credit_cents) })),
  }));
}

/** One statement inserts the entry and its lines only if debits equal credits, so a half-saved or unbalanced entry cannot exist. */
async function insertBalanced(date: string, kind: ManualKind, description: string, reverses: number | null, lines: { account_id: number; debit_cents: number; credit_cents: number }[]): Promise<number | null> {
  const rows = (await sql().query(
    `WITH l AS (SELECT * FROM jsonb_to_recordset($5::jsonb) AS x(account_id bigint, debit_cents bigint, credit_cents bigint)),
          ok AS (SELECT count(*) >= 2 AND sum(debit_cents) = sum(credit_cents) AND sum(debit_cents) > 0 AS good FROM l),
          e AS (INSERT INTO journal_entries (entry_date, kind, description, reverses_id) SELECT $1::date, $2, $3, $4::bigint FROM ok WHERE good RETURNING id)
     INSERT INTO journal_lines (entry_id, account_id, debit_cents, credit_cents) SELECT e.id, l.account_id, l.debit_cents, l.credit_cents FROM e, l RETURNING entry_id`,
    [date, kind, description, reverses, JSON.stringify(lines)],
  )) as Record<string, unknown>[];
  return rows[0] ? Number(rows[0].entry_id) : null;
}

export async function addManualEntry(v: { date: string; kind: ManualKind; description: string; lines: { account_id: number; debit_cents: number; credit_cents: number }[] }): Promise<{ ok: true; id: number } | { ok: false; errors: string[] }> {
  const errors = validateJournal(v.lines.map((l) => ({ accountId: l.account_id, debit: l.debit_cents, credit: l.credit_cents })));
  if (errors.length) return { ok: false, errors };
  const known = new Set((await listAccounts()).filter((a) => a.active).map((a) => a.id));
  if (v.lines.some((l) => !known.has(l.account_id))) return { ok: false, errors: ["Every line needs an active account."] };
  const id = await insertBalanced(v.date, v.kind, v.description, null, v.lines);
  if (id === null) return { ok: false, errors: ["The entry was not saved because it does not balance."] };
  await audit("journal_add", { id, kind: v.kind, date: v.date });
  return { ok: true, id };
}

/** Undo a manual entry by posting its mirror image on the given date; the original stays in the books. Each entry can be reversed once. */
export async function reverseEntry(id: number, date: string): Promise<string | null> {
  const e = (await listManualEntries()).find((x) => x.id === id);
  if (!e) return "That entry was not found.";
  if (e.kind === "reversal") return "A reversal cannot be reversed. Enter a new entry instead.";
  try {
    const rid = await insertBalanced(date, "reversal", `Reversal of entry ${id}: ${e.description}`.slice(0, 120), id, e.lines.map((l) => ({ account_id: l.account_id, debit_cents: l.credit_cents, credit_cents: l.debit_cents })));
    if (rid === null) return "The reversal was not saved.";
  } catch { return "This entry was already reversed."; }
  await audit("journal_reverse", { id, date });
  return null;
}

export async function listAllPayments(): Promise<Payment[]> {
  return (await sql()`SELECT id, tax_year, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, amount_cents, kind FROM tax_payments ORDER BY paid_on, id`).map((r) => ({ id: Number(r.id), tax_year: Number(r.tax_year), paid_on: r.paid_on as string, amount_cents: Number(r.amount_cents), kind: r.kind as PaymentKind }));
}

/** Everything the ledger is calculated from. Always whole history, so balances are never cut short. */
export async function loadLedgerInput(): Promise<LedgerInput> {
  const [accounts, map, income, expenses, movements, payments, manual] = await Promise.all([
    listAccounts(), getMappings(), listIncomeAll(ALL_FROM, ALL_TO), listExpensesAll(ALL_FROM, ALL_TO), listMovements(), listAllPayments(), listManualEntries(),
  ]);
  const items = await listItems(movements);
  return { accounts, ...map, income, expenses, movements, items: items.map((i) => ({ id: i.id, label: i.label })), payments, manual };
}
