import { neon } from "@neondatabase/serverless";
import { EXPORT_ORDER, EXPORT_TABLES, schemaStatements, SCHEMA_VERSION, type ExportTable } from "./schema";
import { emptyRules, type TaxYearRules } from "./taxRules";
import type { Expense, ExpenseInput } from "./expenses";
import type { Trip, TripInput } from "./mileage";
import type { Counts, ImportRow } from "./squareImport";
import type { IncomeEntry, IncomeInput, TaxForm } from "./income";
import type { FormEntry, FormType, Payer, Payment, PaymentKind } from "./taxforms";
import type { ItemInput, Movement, MovementInput } from "./inventory";
import { replay, checkAdd, type Stock } from "./inventory";
import { checkLotConsistency, expiryAlerts, inventoryReport, lotBalances, suggestAllocation, validateAllocation, type LotUse } from "./lots";
import type { PacketInput } from "./packet";

/** Neon over HTTP: one statement per query, no connection to keep open. Only used after requireOwner(). */
export const databaseConfigured = (): boolean => Boolean(process.env.DATABASE_URL);

export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

export async function databaseReady(): Promise<boolean> {
  if (!databaseConfigured()) return false;
  try {
    const rows = await sql()`SELECT to_regclass('public.app_meta') AS t`;
    return rows[0]?.t != null;
  } catch {
    return false;
  }
}

export async function schemaVersion(): Promise<number | null> {
  try {
    const rows = await sql()`SELECT value FROM app_meta WHERE key = 'schema_version'`;
    return rows[0] ? Number(rows[0].value) : null;
  } catch {
    return null;
  }
}

export async function audit(action: string, detail: Record<string, unknown> = {}): Promise<void> {
  await sql()`INSERT INTO audit_log (action, detail) VALUES (${action}, ${JSON.stringify(detail)}::jsonb)`;
}

/** Creates or upgrades the tables. Safe to run again; never drops or rewrites data. */
export async function runSetup(): Promise<number> {
  const q = sql();
  for (const statement of schemaStatements) await q.query(statement);
  await audit("setup", { schema_version: SCHEMA_VERSION });
  return SCHEMA_VERSION;
}

const toNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function getRules(year: number): Promise<TaxYearRules> {
  const rows = await sql()`SELECT * FROM tax_year_rules WHERE tax_year = ${year}`;
  const r = rows[0];
  if (!r) return emptyRules(year);
  return {
    tax_year: year,
    mileage_rate_cents: toNum(r.mileage_rate_cents),
    set_aside_percent: toNum(r.set_aside_percent),
    threshold_1099k_dollars: toNum(r.threshold_1099k_dollars),
    threshold_1099nec_dollars: toNum(r.threshold_1099nec_dollars),
    sales_tax: r.sales_tax,
    mileage_rate_confirmed: r.mileage_rate_confirmed,
    set_aside_confirmed: r.set_aside_confirmed,
    threshold_1099k_confirmed: r.threshold_1099k_confirmed,
    threshold_1099nec_confirmed: r.threshold_1099nec_confirmed,
    sales_tax_confirmed: r.sales_tax_confirmed,
  };
}

export async function saveRules(r: TaxYearRules): Promise<void> {
  await sql()`
    INSERT INTO tax_year_rules (tax_year, mileage_rate_cents, set_aside_percent, threshold_1099k_dollars, threshold_1099nec_dollars, sales_tax,
      mileage_rate_confirmed, set_aside_confirmed, threshold_1099k_confirmed, threshold_1099nec_confirmed, sales_tax_confirmed, updated_at)
    VALUES (${r.tax_year}, ${r.mileage_rate_cents}, ${r.set_aside_percent}, ${r.threshold_1099k_dollars}, ${r.threshold_1099nec_dollars}, ${r.sales_tax},
      ${r.mileage_rate_confirmed}, ${r.set_aside_confirmed}, ${r.threshold_1099k_confirmed}, ${r.threshold_1099nec_confirmed}, ${r.sales_tax_confirmed}, now())
    ON CONFLICT (tax_year) DO UPDATE SET
      mileage_rate_cents = EXCLUDED.mileage_rate_cents, set_aside_percent = EXCLUDED.set_aside_percent,
      threshold_1099k_dollars = EXCLUDED.threshold_1099k_dollars, threshold_1099nec_dollars = EXCLUDED.threshold_1099nec_dollars,
      sales_tax = EXCLUDED.sales_tax, mileage_rate_confirmed = EXCLUDED.mileage_rate_confirmed, set_aside_confirmed = EXCLUDED.set_aside_confirmed,
      threshold_1099k_confirmed = EXCLUDED.threshold_1099k_confirmed, threshold_1099nec_confirmed = EXCLUDED.threshold_1099nec_confirmed,
      sales_tax_confirmed = EXCLUDED.sales_tax_confirmed, updated_at = now()`;
  await audit("save_tax_rules", { tax_year: r.tax_year });
}

/** Every row of every table, for the JSON/CSV export. Table names come from a fixed list, never from the request. */
export async function exportTable(table: ExportTable): Promise<Record<string, unknown>[]> {
  if (!EXPORT_TABLES.includes(table)) throw new Error("unknown table");
  const order = EXPORT_ORDER[table] ?? "id";
  // receipt photos are listed (id, size, date) but their image bytes are not put in the JSON/CSV export; view them one by one in the app
  const cols = table === "expense_receipts" ? "id, expense_id, content_type, bytes_len, created_at" : "*";
  return (await sql().query(`SELECT ${cols} FROM ${table} ORDER BY ${order}`)) as Record<string, unknown>[];
}

// ---- Phase 1: income and inventory. Dates are read as text (to_char) and bigint sums as numbers so nothing shifts or overflows. ----

export async function listIncome(from: string, to: string, limit = 500): Promise<IncomeEntry[]> {
  const rows = await sql()`
    SELECT i.id, to_char(i.occurred_on, 'YYYY-MM-DD') AS occurred_on, i.source, i.tax_form, i.gross_cents, i.tip_cents, i.fee_cents, i.visits,
           (i.external_id IS NOT NULL) AS imported, p.payer_id
    FROM income_entries i LEFT JOIN income_entry_payers p ON p.income_id = i.id
    WHERE i.occurred_on BETWEEN ${from}::date AND ${to}::date ORDER BY i.occurred_on DESC, i.id DESC LIMIT ${limit}`;
  return rows.map((r) => ({ id: Number(r.id), occurred_on: r.occurred_on, source: r.source, tax_form: r.tax_form as TaxForm, gross_cents: Number(r.gross_cents), tip_cents: Number(r.tip_cents), fee_cents: Number(r.fee_cents), visits: Number(r.visits), imported: r.imported === true || r.imported === "t" || r.imported === "true", payer_id: r.payer_id === null || r.payer_id === undefined ? null : Number(r.payer_id) }));
}

export async function addIncome(v: IncomeInput): Promise<void> {
  await sql().query(
    `WITH i AS (INSERT INTO income_entries (occurred_on, source, tax_form, gross_cents, tip_cents, fee_cents, visits)
                VALUES ($1::date, $2, $3, $4, $5, $6, $7) RETURNING id)
     INSERT INTO income_entry_payers (income_id, payer_id) SELECT i.id, $8::bigint FROM i WHERE $8::bigint IS NOT NULL`,
    [v.occurred_on, v.source, v.tax_form, v.gross_cents, v.tip_cents, v.fee_cents, v.visits, v.payer_id]);
  await audit("add_income", { occurred_on: v.occurred_on, source: v.source });
}

/** Visits can be set or corrected on any entry, including imported ones. */
export async function setVisits(id: number, visits: number): Promise<void> {
  const rows = await sql()`UPDATE income_entries SET visits = ${visits} WHERE id = ${id} RETURNING id`;
  if (rows.length) await audit("set_visits", { id, visits });
}

/** Only hand-entered rows can be deleted; imported rows are removed by re-importing, never here. */
export async function deleteManualIncome(id: number): Promise<boolean> {
  const rows = await sql()`WITH l AS (DELETE FROM income_entry_payers WHERE income_id = ${id} AND EXISTS (SELECT 1 FROM income_entries WHERE id = ${id} AND external_id IS NULL))
                           DELETE FROM income_entries WHERE id = ${id} AND external_id IS NULL RETURNING id`;
  if (rows.length) await audit("delete_income", { id });
  return rows.length > 0;
}

/** The most recent Square import's refund-row count (a re-import of the same file must not add to it). */
export async function lastImportRefunds(): Promise<{ n: number; first: string | null; last: string | null } | null> {
  const r = (await sql()`SELECT rows_refund_flagged AS n, to_char(first_date,'YYYY-MM-DD') AS first, to_char(last_date,'YYYY-MM-DD') AS last FROM import_batches ORDER BY id DESC LIMIT 1`)[0];
  return r ? { n: Number(r.n), first: r.first ?? null, last: r.last ?? null } : null;
}

export async function existingSquareIds(ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await sql().query(`SELECT external_id FROM income_entries WHERE source = 'square' AND external_id = ANY($1::text[])`, [ids.slice(i, i + 1000)]);
    for (const r of rows as { external_id: string }[]) found.add(r.external_id);
  }
  return found;
}

/** Saves the new rows and one batch record in a single statement. Rows already present are skipped by the database itself (unique key), so a repeat or overlapping import adds nothing twice. */
export async function importSquareRows(rows: ImportRow[], counts: Counts, visitsEach: 0 | 1): Promise<{ added: number; duplicates: number }> {
  const existing = await existingSquareIds(rows.map((r) => r.external_id));
  const fresh = rows.filter((r) => !existing.has(r.external_id));
  const dates = rows.map((r) => r.occurred_on).sort();
  const res = await sql().query(
    `WITH b AS (
       INSERT INTO import_batches (source, rows_read, rows_added, rows_duplicate, rows_refund_flagged, rows_skipped, first_date, last_date)
       VALUES ('square', $1, $2, $3, $4, $5, $6::date, $7::date) RETURNING id),
     ins AS (
       INSERT INTO income_entries (occurred_on, source, tax_form, gross_cents, tip_cents, fee_cents, visits, external_id, import_batch_id)
       SELECT u.d, 'square', 'unknown', u.g, u.t, u.f, $13::int, u.x, (SELECT id FROM b)
       FROM unnest($8::text[], $9::date[], $10::bigint[], $11::bigint[], $12::bigint[]) AS u(x, d, g, t, f)
       ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO NOTHING RETURNING id)
     SELECT (SELECT id FROM b) AS batch_id, (SELECT count(*) FROM ins) AS added`,
    [counts.read, fresh.length, counts.duplicateInFile + existing.size, counts.refund, counts.failed + counts.uncertain, dates[0] ?? null, dates[dates.length - 1] ?? null,
     fresh.map((r) => r.external_id), fresh.map((r) => r.occurred_on), fresh.map((r) => r.gross_cents), fresh.map((r) => r.tip_cents), fresh.map((r) => r.fee_cents), visitsEach],
  );
  const added = Number((res as { added: string }[])[0].added), batch = Number((res as { batch_id: string }[])[0].batch_id);
  const duplicates = counts.duplicateInFile + (rows.length - added);
  if (added !== fresh.length) await sql()`UPDATE import_batches SET rows_added = ${added}, rows_duplicate = ${duplicates} WHERE id = ${batch}`;
  await audit("import_square", { batch, added, duplicates, refund_rows_flagged: counts.refund, skipped: counts.failed + counts.uncertain });
  return { added, duplicates };
}

export interface ItemRow { id: number; label: string; category: string; unit: string; reorder_level: number | null }
export interface ItemWithStock extends ItemRow { stock: Stock; error?: string }

const toMovement = (r: Record<string, unknown>): Movement => ({
  id: Number(r.id), item_id: Number(r.item_id), moved_on: r.moved_on as string, kind: r.kind as Movement["kind"], quantity: Number(r.quantity),
  unit_cost_cents: r.unit_cost_cents === null ? null : Number(r.unit_cost_cents), reason: r.reason as Movement["reason"], lot_number: r.lot_number as string | null, expires_on: r.expires_on as string | null,
});
const MOVEMENT_COLS = `id, item_id, to_char(moved_on,'YYYY-MM-DD') AS moved_on, kind, quantity, unit_cost_cents, reason, lot_number, to_char(expires_on,'YYYY-MM-DD') AS expires_on`;

export async function listMovements(itemId?: number): Promise<Movement[]> {
  const rows = itemId === undefined
    ? await sql().query(`SELECT ${MOVEMENT_COLS} FROM inventory_movements ORDER BY moved_on, id`)
    : await sql().query(`SELECT ${MOVEMENT_COLS} FROM inventory_movements WHERE item_id = $1 ORDER BY moved_on, id`, [itemId]);
  return (rows as Record<string, unknown>[]).map(toMovement);
}

export async function listItems(): Promise<ItemWithStock[]> {
  const items = (await sql()`SELECT id, label, category, unit, reorder_level FROM inventory_items ORDER BY category, lower(label)`).map((r) => ({
    id: Number(r.id), label: r.label as string, category: r.category as string, unit: r.unit as string, reorder_level: r.reorder_level === null ? null : Number(r.reorder_level),
  }));
  const all = await listMovements();
  return items.map((it) => {
    const r = replay(all.filter((m) => m.item_id === it.id));
    return r.ok ? { ...it, stock: r } : { ...it, stock: { onHand: 0, valueCents: 0, avgCostCents: 0 }, error: r.error };
  });
}

export async function getItem(id: number): Promise<ItemRow | null> {
  const r = (await sql()`SELECT id, label, category, unit, reorder_level FROM inventory_items WHERE id = ${id}`)[0];
  return r ? { id: Number(r.id), label: r.label, category: r.category, unit: r.unit, reorder_level: r.reorder_level === null ? null : Number(r.reorder_level) } : null;
}

export async function addItem(v: ItemInput): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const dup = await sql()`SELECT 1 FROM inventory_items WHERE lower(label) = lower(${v.label})`;
  if (dup.length) return { ok: false, error: "An item with that name already exists." };
  const r = await sql()`INSERT INTO inventory_items (label, category, unit, reorder_level) VALUES (${v.label}, ${v.category}, ${v.unit}, ${v.reorder_level}) RETURNING id`;
  await audit("add_item", { id: Number(r[0].id) });
  return { ok: true, id: Number(r[0].id) };
}

export async function setReorderLevel(id: number, level: number | null): Promise<void> {
  await sql()`UPDATE inventory_items SET reorder_level = ${level} WHERE id = ${id}`;
  await audit("set_reorder_level", { id, level });
}

/**
 * Appends one movement after replaying the whole history with it included (stock can never go negative). For a use or removal of an item that
 * has lots, `allocations` says which lots it came from: "auto" = earliest-expiring first, or an explicit list that is checked against each lot.
 * The movement and its lot rows are saved in one statement. Returns an error message instead of saving when anything does not add up.
 */
export async function addMovement(v: MovementInput, allocations: "auto" | { lot_number: string; quantity: number }[] = []): Promise<string | null> {
  if (!(await getItem(v.item_id))) return "Item not found.";
  const moves = await listMovements(v.item_id);
  const err = checkAdd(moves, v) ?? checkLotConsistency(moves, v);
  if (err) return err;
  let allocs: { lot_number: string; quantity: number }[] = [];
  if (v.kind === "use" || v.kind === "adjust_down") {
    const lots = lotBalances(moves, await listLotUses(v.item_id));
    if (allocations === "auto") allocs = lots.length ? suggestAllocation(lots, v.quantity).allocations : [];
    else if (allocations.length) { const e = validateAllocation(lots, allocations, v.quantity, v.moved_on); if (e) return e; allocs = allocations; }
  }
  await sql().query(
    `WITH m AS (
       INSERT INTO inventory_movements (item_id, moved_on, kind, quantity, unit_cost_cents, reason, lot_number, expires_on)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8::date) RETURNING id),
     u AS (
       INSERT INTO inventory_lot_uses (movement_id, lot_number, quantity)
       SELECT (SELECT id FROM m), x.l, x.q FROM unnest($9::text[], $10::int[]) AS x(l, q) RETURNING id)
     SELECT (SELECT id FROM m) AS id, (SELECT count(*) FROM u) AS lots`,
    [v.item_id, v.moved_on, v.kind, v.quantity, v.unit_cost_cents, v.reason, v.lot_number, v.expires_on, allocs.map((a) => a.lot_number), allocs.map((a) => a.quantity)],
  );
  await audit("add_movement", { item_id: v.item_id, kind: v.kind, quantity: v.quantity, lots: allocs.length });
  return null;
}

export async function listLotUses(itemId?: number): Promise<LotUse[]> {
  const rows = itemId === undefined
    ? await sql().query(`SELECT movement_id, lot_number, quantity FROM inventory_lot_uses ORDER BY id`)
    : await sql().query(`SELECT u.movement_id, u.lot_number, u.quantity FROM inventory_lot_uses u JOIN inventory_movements m ON m.id = u.movement_id WHERE m.item_id = $1 ORDER BY u.id`, [itemId]);
  return (rows as Record<string, unknown>[]).map((r) => ({ movement_id: Number(r.movement_id), lot_number: r.lot_number as string, quantity: Number(r.quantity) }));
}

export async function insertLotUses(rows: LotUse[]): Promise<void> {
  if (!rows.length) return;
  await sql().query(`INSERT INTO inventory_lot_uses (movement_id, lot_number, quantity) SELECT x.m, x.l, x.q FROM unnest($1::bigint[], $2::text[], $3::int[]) AS x(m, l, q)`,
    [rows.map((r) => r.movement_id), rows.map((r) => r.lot_number), rows.map((r) => r.quantity)]);
  await audit("assign_past_uses", { rows: rows.length });
}

export async function warnDaysByItem(): Promise<Map<number, number>> {
  const rows = await sql()`SELECT item_id, expiry_warn_days FROM inventory_settings`;
  return new Map(rows.map((r) => [Number(r.item_id), Number(r.expiry_warn_days)]));
}

/** null removes the per-item setting (back to the 30-day default). */
export async function setWarnDays(itemId: number, days: number | null): Promise<void> {
  if (days === null) await sql()`DELETE FROM inventory_settings WHERE item_id = ${itemId}`;
  else await sql()`INSERT INTO inventory_settings (item_id, expiry_warn_days) VALUES (${itemId}, ${days}) ON CONFLICT (item_id) DO UPDATE SET expiry_warn_days = EXCLUDED.expiry_warn_days, updated_at = now()`;
  await audit("set_expiry_warning", { item_id: itemId, days });
}

// ---- Phase 2: expenses, receipt photos, mileage ----
export async function listExpenses(from: string, to: string, limit = 500): Promise<Expense[]> {
  const rows = await sql()`
    SELECT e.id, to_char(e.spent_on, 'YYYY-MM-DD') AS spent_on, e.amount_cents, e.category, e.vendor, e.receipt_on_file,
           (SELECT count(*) FROM expense_receipts r WHERE r.expense_id = e.id) AS photos
    FROM expenses e WHERE e.spent_on BETWEEN ${from}::date AND ${to}::date ORDER BY e.spent_on DESC, e.id DESC LIMIT ${limit}`;
  return rows.map((r) => ({ id: Number(r.id), spent_on: r.spent_on, amount_cents: Number(r.amount_cents), category: r.category, vendor: r.vendor ?? null,
    receipt_on_file: r.receipt_on_file === true || r.receipt_on_file === "t" || r.receipt_on_file === "true", photos: Number(r.photos) }));
}

/** Saves the expense and, if given, its first photo in ONE statement, so an expense can never exist half-saved. */
export async function addExpense(v: ExpenseInput, photo?: Uint8Array): Promise<number> {
  const r = await sql().query(
    `WITH e AS (INSERT INTO expenses (spent_on, amount_cents, category, vendor, receipt_on_file) VALUES ($1::date, $2, $3, $4, $5) RETURNING id),
          p AS (INSERT INTO expense_receipts (expense_id, bytes_len, data) SELECT e.id, $6::int, decode($7::text, 'base64') FROM e WHERE $7::text IS NOT NULL RETURNING id)
     SELECT (SELECT id FROM e) AS id`,
    [v.spent_on, v.amount_cents, v.category, v.vendor, v.receipt_on_file, photo ? photo.length : null, photo ? Buffer.from(photo).toString("base64") : null]);
  const id = Number((r as { id: string }[])[0].id);
  await audit("add_expense", { id, category: v.category, amount_cents: v.amount_cents });
  if (photo) await audit("add_receipt", { expense_id: id, bytes: photo.length });
  return id;
}

/** Deletes the expense and its photos together, in one statement. */
export async function deleteExpense(id: number): Promise<boolean> {
  const rows = await sql()`WITH p AS (DELETE FROM expense_receipts WHERE expense_id = ${id}) DELETE FROM expenses WHERE id = ${id} RETURNING id, amount_cents, category`;
  if (rows.length) await audit("delete_expense", { id, category: rows[0].category, amount_cents: Number(rows[0].amount_cents) });
  return rows.length > 0;
}

export async function countReceipts(expenseId: number): Promise<number> {
  return Number((await sql()`SELECT count(*) AS n FROM expense_receipts WHERE expense_id = ${expenseId}`)[0].n);
}

export async function expenseExists(id: number): Promise<boolean> {
  return (await sql()`SELECT 1 FROM expenses WHERE id = ${id}`).length > 0;
}

/** Image bytes travel as base64 text so the HTTP driver handles them the same way everywhere. */
export async function addReceipt(expenseId: number, bytes: Uint8Array): Promise<void> {
  await sql()`INSERT INTO expense_receipts (expense_id, bytes_len, data) VALUES (${expenseId}, ${bytes.length}, decode(${Buffer.from(bytes).toString("base64")}, 'base64'))`;
  await audit("add_receipt", { expense_id: expenseId, bytes: bytes.length });
}

export async function receiptIds(expenseId: number): Promise<number[]> {
  return (await sql()`SELECT id FROM expense_receipts WHERE expense_id = ${expenseId} ORDER BY id`).map((r) => Number(r.id));
}

export async function getReceiptBytes(id: number): Promise<Buffer | null> {
  const r = (await sql()`SELECT encode(data, 'base64') AS b64 FROM expense_receipts WHERE id = ${id}`)[0];
  return r ? Buffer.from(String(r.b64), "base64") : null;
}

export async function deleteReceipt(id: number): Promise<void> {
  const rows = await sql()`DELETE FROM expense_receipts WHERE id = ${id} RETURNING expense_id`;
  if (rows.length) await audit("delete_receipt", { id, expense_id: Number(rows[0].expense_id) });
}

export async function listTrips(from: string, to: string, limit = 500): Promise<Trip[]> {
  const rows = await sql()`
    SELECT id, to_char(driven_on, 'YYYY-MM-DD') AS driven_on, miles_tenths, purpose, odometer_start, odometer_end
    FROM mileage_trips WHERE driven_on BETWEEN ${from}::date AND ${to}::date ORDER BY driven_on DESC, id DESC LIMIT ${limit}`;
  return rows.map((r) => ({ id: Number(r.id), driven_on: r.driven_on, miles_tenths: Number(r.miles_tenths), purpose: r.purpose,
    odometer_start: r.odometer_start === null ? null : Number(r.odometer_start), odometer_end: r.odometer_end === null ? null : Number(r.odometer_end) }));
}

export async function addTrip(v: TripInput): Promise<void> {
  await sql()`INSERT INTO mileage_trips (driven_on, miles_tenths, purpose, odometer_start, odometer_end)
              VALUES (${v.driven_on}::date, ${v.miles_tenths}, ${v.purpose}, ${v.odometer_start}, ${v.odometer_end})`;
  await audit("add_trip", { driven_on: v.driven_on, miles_tenths: v.miles_tenths });
}

export async function deleteTrip(id: number): Promise<void> {
  const rows = await sql()`DELETE FROM mileage_trips WHERE id = ${id} RETURNING id`;
  if (rows.length) await audit("delete_trip", { id });
}

/** Inventory purchases in a period, shown beside expenses only as a reminder. They are not expenses. */
export async function inventoryPurchasesTotal(from: string, to: string): Promise<number> {
  const r = await sql()`SELECT COALESCE(SUM(quantity::bigint * unit_cost_cents), 0) AS t FROM inventory_movements WHERE kind = 'purchase' AND moved_on BETWEEN ${from}::date AND ${to}::date`;
  return Number(r[0].t);
}

// ---- Phase 4: payers, 1099 form amounts, tax payments, bulk tax form, packet snapshots ----
export async function listPayers(): Promise<Payer[]> {
  return (await sql()`SELECT id, label FROM payers ORDER BY lower(label)`).map((r) => ({ id: Number(r.id), label: r.label as string }));
}

export async function addPayer(label: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if ((await sql()`SELECT 1 FROM payers WHERE lower(label) = lower(${label})`).length) return { ok: false, error: "That payer is already in the list." };
  const r = await sql()`INSERT INTO payers (label) VALUES (${label}) RETURNING id`;
  await audit("add_payer", { id: Number(r[0].id) });
  return { ok: true };
}

export async function listForms(year: number): Promise<FormEntry[]> {
  return (await sql()`SELECT id, tax_year, form_type, payer_id, amount_cents FROM form_1099_entries WHERE tax_year = ${year} ORDER BY id`).map((r) => ({
    id: Number(r.id), tax_year: Number(r.tax_year), form_type: r.form_type as FormType, payer_id: r.payer_id === null ? null : Number(r.payer_id), amount_cents: Number(r.amount_cents) }));
}
export async function addForm(v: { tax_year: number; form_type: FormType; payer_id: number | null; amount_cents: number }): Promise<void> {
  await sql()`INSERT INTO form_1099_entries (tax_year, form_type, payer_id, amount_cents) VALUES (${v.tax_year}, ${v.form_type}, ${v.payer_id}, ${v.amount_cents})`;
  await audit("add_1099_form", { tax_year: v.tax_year, form_type: v.form_type });
}
export async function deleteForm(id: number): Promise<void> {
  const rows = await sql()`DELETE FROM form_1099_entries WHERE id = ${id} RETURNING id`;
  if (rows.length) await audit("delete_1099_form", { id });
}

export async function listPayments(year: number): Promise<Payment[]> {
  return (await sql()`SELECT id, tax_year, to_char(paid_on,'YYYY-MM-DD') AS paid_on, amount_cents, kind FROM tax_payments WHERE tax_year = ${year} ORDER BY paid_on, id`).map((r) => ({
    id: Number(r.id), tax_year: Number(r.tax_year), paid_on: r.paid_on as string, amount_cents: Number(r.amount_cents), kind: r.kind as PaymentKind }));
}
export async function addPayment(v: { tax_year: number; paid_on: string; amount_cents: number; kind: PaymentKind }): Promise<void> {
  await sql()`INSERT INTO tax_payments (tax_year, paid_on, amount_cents, kind) VALUES (${v.tax_year}, ${v.paid_on}::date, ${v.amount_cents}, ${v.kind})`;
  await audit("add_tax_payment", { tax_year: v.tax_year, amount_cents: v.amount_cents });
}
export async function deletePayment(id: number): Promise<void> {
  const rows = await sql()`DELETE FROM tax_payments WHERE id = ${id} RETURNING id`;
  if (rows.length) await audit("delete_tax_payment", { id });
}

/** How many Square entries in the year still have no tax form chosen. */
export async function countUndecidedSquare(year: number): Promise<number> {
  const r = await sql()`SELECT count(*) AS n FROM income_entries WHERE source = 'square' AND tax_form = 'unknown' AND occurred_on BETWEEN ${`${year}-01-01`}::date AND ${`${year}-12-31`}::date`;
  return Number(r[0].n);
}
/** Sets the tax form on Square entries of one year that are still undecided. Never overwrites a choice already made. */
export async function bulkSetSquareForm(year: number, form: "1099k" | "1099nec" | "none"): Promise<number> {
  const rows = await sql()`UPDATE income_entries SET tax_form = ${form} WHERE source = 'square' AND tax_form = 'unknown' AND occurred_on BETWEEN ${`${year}-01-01`}::date AND ${`${year}-12-31`}::date RETURNING id`;
  await audit("bulk_set_tax_form", { year, form, rows: rows.length });
  return rows.length;
}

export async function saveSnapshot(year: number, packet: unknown): Promise<number> {
  const r = await sql()`INSERT INTO tax_snapshots (tax_year, packet) VALUES (${year}, ${JSON.stringify(packet)}::jsonb) RETURNING id`;
  await audit("save_tax_snapshot", { id: Number(r[0].id), year });
  return Number(r[0].id);
}
export async function listSnapshots(year: number): Promise<{ id: number; created_at: string }[]> {
  return (await sql()`SELECT id, to_char(created_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI') AS created_at FROM tax_snapshots WHERE tax_year = ${year} ORDER BY id DESC`).map((r) => ({ id: Number(r.id), created_at: r.created_at as string }));
}
export async function getSnapshot(id: number): Promise<unknown | null> {
  const r = (await sql()`SELECT packet FROM tax_snapshots WHERE id = ${id}`)[0];
  return r ? (typeof r.packet === "string" ? JSON.parse(r.packet) : r.packet) : null;
}

/** Everything the year-end packet needs, read from the database. */
export async function loadPacketInput(year: number, today: string): Promise<PacketInput> {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const items = await listItems(), movements = await listMovements();
  const expired = expiryAlerts(items, movements, await listLotUses(), await warnDaysByItem(), today).filter((a) => a.status === "expired").length;
  return {
    year, income: await listIncomeAll(from, to), expenses: await listExpensesAll(from, to), trips: await listTripsAll(from, to), rules: await getRules(year),
    forms: await listForms(year), payers: await listPayers(), payments: await listPayments(year),
    inventory: inventoryReport(items, movements, from, to), expiredLots: expired, lastImportRefunds: (await lastImportRefunds())?.n ?? 0,
  };
}

// ---- Phase 5: whole-year lists that must never be silently cut short, and the activity log ----
const BIG = 50_000;
function capped<T>(rows: T[], what: string): T[] {
  if (rows.length > BIG) throw new Error(`Too many ${what} rows to show at once (over ${BIG}).`);
  return rows;
}
export const listIncomeAll = async (from: string, to: string) => capped(await listIncome(from, to, BIG + 1), "income");
export const listExpensesAll = async (from: string, to: string) => capped(await listExpenses(from, to, BIG + 1), "expense");
export const listTripsAll = async (from: string, to: string) => capped(await listTrips(from, to, BIG + 1), "mileage");

export async function listActivity(beforeId: number | null, limit = 100): Promise<{ id: number; at: string; action: string; detail: unknown }[]> {
  const rows = await sql()`
    SELECT id, to_char(at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI') AS at, action, detail
    FROM audit_log WHERE (${beforeId}::bigint IS NULL OR id < ${beforeId}::bigint) ORDER BY id DESC LIMIT ${limit}`;
  return rows.map((r) => ({ id: Number(r.id), at: r.at as string, action: r.action as string, detail: r.detail }));
}
