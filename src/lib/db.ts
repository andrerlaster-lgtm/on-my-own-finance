import { neon } from "@neondatabase/serverless";
import { EXPORT_ORDER, EXPORT_TABLES, schemaStatements, SCHEMA_VERSION, type ExportTable } from "./schema";
import { emptyRules, type TaxYearRules } from "./taxRules";
import type { Expense, ExpenseInput } from "./expenses";
import type { PendingTrip, Trip, TripInput } from "./mileage";
import type { Counts, ImportRow } from "./squareImport";
import type { IncomeEntry, IncomeInput, TaxForm } from "./income";
import type { FormEntry, FormType, Payer, Payment, PaymentKind } from "./taxforms";
import type { ItemInput, Movement, MovementInput } from "./inventory";
import { replay, checkAdd, type Stock } from "./inventory";
import { checkLotConsistency, expiryAlerts, inventoryReport, lotBalances, suggestAllocation, validateAllocation, type LotUse } from "./lots";
import type { PacketInput } from "./packet";
import type { Appointment, AppointmentInput, Service, Status, CancelReason } from "./schedule";
import { conflictText, findConflicts } from "./schedule";
import { dbErrorText, dbErrorCode, planSupplies, stockToken, type AppointmentPayment, type CompletionInput, type PaymentInput } from "./finance";

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
    mileage_rate_h2_cents: toNum(r.mileage_rate_h2_cents),
    set_aside_percent: toNum(r.set_aside_percent),
    threshold_1099k_dollars: toNum(r.threshold_1099k_dollars),
    threshold_1099nec_dollars: toNum(r.threshold_1099nec_dollars),
    sales_tax: r.sales_tax,
    mileage_rate_confirmed: r.mileage_rate_confirmed,
    mileage_rate_h2_confirmed: Boolean(r.mileage_rate_h2_confirmed),
    set_aside_confirmed: r.set_aside_confirmed,
    threshold_1099k_confirmed: r.threshold_1099k_confirmed,
    threshold_1099nec_confirmed: r.threshold_1099nec_confirmed,
    sales_tax_confirmed: r.sales_tax_confirmed,
  };
}

export async function saveRules(r: TaxYearRules): Promise<void> {
  // The July 1 mileage rate columns arrive with schema version 6. Until the database is updated, save everything else as before.
  const v = (await schemaVersion()) ?? 0;
  if (v >= 6) {
    await sql()`
      INSERT INTO tax_year_rules (tax_year, mileage_rate_cents, mileage_rate_h2_cents, set_aside_percent, threshold_1099k_dollars, threshold_1099nec_dollars, sales_tax,
        mileage_rate_confirmed, mileage_rate_h2_confirmed, set_aside_confirmed, threshold_1099k_confirmed, threshold_1099nec_confirmed, sales_tax_confirmed, updated_at)
      VALUES (${r.tax_year}, ${r.mileage_rate_cents}, ${r.mileage_rate_h2_cents}, ${r.set_aside_percent}, ${r.threshold_1099k_dollars}, ${r.threshold_1099nec_dollars}, ${r.sales_tax},
        ${r.mileage_rate_confirmed}, ${r.mileage_rate_h2_confirmed}, ${r.set_aside_confirmed}, ${r.threshold_1099k_confirmed}, ${r.threshold_1099nec_confirmed}, ${r.sales_tax_confirmed}, now())
      ON CONFLICT (tax_year) DO UPDATE SET
        mileage_rate_cents = EXCLUDED.mileage_rate_cents, mileage_rate_h2_cents = EXCLUDED.mileage_rate_h2_cents, set_aside_percent = EXCLUDED.set_aside_percent,
        threshold_1099k_dollars = EXCLUDED.threshold_1099k_dollars, threshold_1099nec_dollars = EXCLUDED.threshold_1099nec_dollars,
        sales_tax = EXCLUDED.sales_tax, mileage_rate_confirmed = EXCLUDED.mileage_rate_confirmed, mileage_rate_h2_confirmed = EXCLUDED.mileage_rate_h2_confirmed,
        set_aside_confirmed = EXCLUDED.set_aside_confirmed, threshold_1099k_confirmed = EXCLUDED.threshold_1099k_confirmed,
        threshold_1099nec_confirmed = EXCLUDED.threshold_1099nec_confirmed, sales_tax_confirmed = EXCLUDED.sales_tax_confirmed, updated_at = now()`;
  } else {
    if (r.mileage_rate_h2_cents !== null) throw new Error("The July 1 mileage rate needs the database update first (press Update on the home page).");
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
  }
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

/** Only hand-entered rows can be deleted; imported rows are removed by re-importing, never here. Income that came from an appointment payment is protected by its link (refused, nothing changes). */
export async function deleteManualIncome(id: number): Promise<boolean> {
  let rows;
  try {
    rows = await sql()`WITH l AS (DELETE FROM income_entry_payers WHERE income_id = ${id} AND EXISTS (SELECT 1 FROM income_entries WHERE id = ${id} AND external_id IS NULL))
                       DELETE FROM income_entries WHERE id = ${id} AND external_id IS NULL RETURNING id`;
  } catch (e) { if ((e as { code?: string })?.code === "23503" || /foreign key/i.test((e as Error)?.message ?? "")) return false; throw e; }
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
  if (((await schemaVersion()) ?? 0) >= 11) await reconcileSquareAuto(); // appointment payments waiting for this import, matched by exact Square payment ID only
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

export async function listItems(preloaded?: Movement[]): Promise<ItemWithStock[]> {
  const items = (await sql()`SELECT id, label, category, unit, reorder_level FROM inventory_items ORDER BY category, lower(label)`).map((r) => ({
    id: Number(r.id), label: r.label as string, category: r.category as string, unit: r.unit as string, reorder_level: r.reorder_level === null ? null : Number(r.reorder_level),
  }));
  const all = preloaded ?? (await listMovements());
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

/** Photo ids for many expenses in one query: Map(expense id -> photo ids). */
export async function receiptIdsFor(expenseIds: number[]): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (!expenseIds.length) return out;
  const rows = await sql().query("SELECT id, expense_id FROM expense_receipts WHERE expense_id = ANY($1::bigint[]) ORDER BY id", [expenseIds]);
  for (const r of rows as { id: string; expense_id: string }[]) out.set(Number(r.expense_id), [...(out.get(Number(r.expense_id)) ?? []), Number(r.id)]);
  return out;
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

/* Temporary stops (mileage_pending): erased at the end of the next day. Every read erases expired rows first and never returns them. */
export async function purgePendingTrips(): Promise<void> {
  try { await sql()`DELETE FROM mileage_pending WHERE expires_at <= now()`; } catch { /* table not created yet */ }
}
export async function listPendingTrips(): Promise<PendingTrip[]> {
  try {
    await purgePendingTrips();
    return (await sql()`SELECT id, to_char(driven_on, 'YYYY-MM-DD') AS driven_on, start_text, end_text, purpose FROM mileage_pending WHERE expires_at > now() ORDER BY driven_on DESC, id DESC`)
      .map((r) => ({ id: Number(r.id), driven_on: r.driven_on as string, start_text: r.start_text as string, end_text: r.end_text as string, purpose: r.purpose as PendingTrip["purpose"] }));
  } catch { return []; }
}
export async function addPendingTrip(v: Omit<PendingTrip, "id">): Promise<void> {
  await sql()`INSERT INTO mileage_pending (driven_on, start_text, end_text, purpose, expires_at)
              VALUES (${v.driven_on}::date, ${v.start_text}, ${v.end_text}, ${v.purpose}, (date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '2 days') AT TIME ZONE 'America/Chicago')`;
  await audit("add_pending_trip", { driven_on: v.driven_on }); // the stops themselves are never written to the log
}
export async function deletePendingTrip(id: number): Promise<void> {
  await sql()`DELETE FROM mileage_pending WHERE id = ${id}`;
}
/** Saves the finished trip (miles, optional odometer) and erases the typed stops in one statement. */
export async function completePendingTrip(id: number, miles_tenths: number, odometer_start: number | null, odometer_end: number | null): Promise<boolean> {
  const rows = await sql()`WITH p AS (DELETE FROM mileage_pending WHERE id = ${id} AND expires_at > now() RETURNING driven_on, purpose)
    INSERT INTO mileage_trips (driven_on, miles_tenths, purpose, odometer_start, odometer_end) SELECT driven_on, ${miles_tenths}, purpose, ${odometer_start}, ${odometer_end} FROM p RETURNING id`;
  if (rows.length) await audit("add_trip", { miles_tenths });
  return rows.length > 0;
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
  const [movements, uses, warn, income, expenses, trips, rules, forms, payers, payments, refunds] = await Promise.all([
    listMovements(), listLotUses(), warnDaysByItem(), listIncomeAll(from, to), listExpensesAll(from, to), listTripsAll(from, to), getRules(year),
    listForms(year), listPayers(), listPayments(year), lastImportRefunds(),
  ]);
  const items = await listItems(movements);
  const expired = expiryAlerts(items, movements, uses, warn, today).filter((a) => a.status === "expired").length;
  return { year, income, expenses, trips, rules, forms, payers, payments, inventory: inventoryReport(items, movements, from, to), expiredLots: expired, lastImportRefunds: refunds?.n ?? 0 };
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

// ---- Secretary: appointments (schema version 9). No money, inventory or personal details are touched or stored here. ----
const toMs = (v: unknown): number => Number(v);
const apptFrom = (r: Record<string, unknown>): Appointment => ({
  id: Number(r.id), type: r.type as Appointment["type"], status: r.status as Status, service_code: r.service_code as string,
  starts_at: toMs(r.starts_ms), ends_at: toMs(r.ends_ms), cancel_reason: (r.cancel_reason as CancelReason | null) ?? null, source: r.source as string, external_ref: (r.external_ref as string | null) ?? null,
  price_cents: r.price_cents === null || r.price_cents === undefined ? null : Number(r.price_cents), paid_cents: Number(r.paid_cents ?? 0),
});
const APPT_COLS = `id, type, status, service_code, (extract(epoch from starts_at) * 1000)::bigint AS starts_ms, (extract(epoch from ends_at) * 1000)::bigint AS ends_ms, cancel_reason, source, external_ref, price_cents, coalesce((SELECT sum(p.amount_cents) FROM appointment_payments p WHERE p.appointment_id = appointments.id), 0)::bigint AS paid_cents`;
const iso = (ms: number) => new Date(ms).toISOString();

export async function listServices(): Promise<Service[]> {
  const rows = await sql()`SELECT code, label, default_minutes, active FROM appointment_services ORDER BY sort_order, label`;
  return rows.map((r) => ({ code: r.code as string, label: r.label as string, default_minutes: Number(r.default_minutes), active: r.active === true || r.active === "t" || r.active === "true" }));
}

/**
 * Appointments that occupy any part of [fromMs, toMs) (a Chicago day or week), earliest first, each returned once. One that starts before the window and
 * runs into it (across midnight) is included. Appointments last at most 12 hours (a table CHECK), which lets the start-time index narrow the search.
 * Canceled ones are included; callers decide whether to show them.
 */
export async function listAppointments(fromMs: number, toMsExclusive: number): Promise<Appointment[]> {
  const rows = await sql().query(`SELECT ${APPT_COLS} FROM appointments WHERE starts_at >= $1::timestamptz - interval '12 hours' AND starts_at < $2::timestamptz AND ends_at > $1::timestamptz ORDER BY starts_at, id`, [iso(fromMs), iso(toMsExclusive)]);
  return (rows as Record<string, unknown>[]).map(apptFrom);
}

export async function getAppointment(id: number): Promise<Appointment | null> {
  const rows = await sql().query(`SELECT ${APPT_COLS} FROM appointments WHERE id = $1::bigint`, [id]);
  return rows[0] ? apptFrom(rows[0] as Record<string, unknown>) : null;
}

/** Open (not canceled) appointments that overlap a time span. */
async function overlapping(fromMs: number, toMsExclusive: number): Promise<Appointment[]> {
  const rows = await sql().query(`SELECT ${APPT_COLS} FROM appointments WHERE status <> 'canceled' AND tstzrange(starts_at, ends_at) && tstzrange($1::timestamptz, $2::timestamptz)`, [iso(fromMs), iso(toMsExclusive)]);
  return (rows as Record<string, unknown>[]).map(apptFrom);
}
const isOverlapError = (e: unknown) => /exclusion constraint|23P01/.test(`${(e as { code?: string })?.code ?? ""} ${(e as Error)?.message ?? ""}`);
const RACE = "Another appointment was just booked for that time. Pick a different time.";

export type SaveResult = { ok: true; id: number } | { ok: false; error: string };

/** Adds an appointment unless it overlaps an open one. The check is repeated by the database itself, so two people saving at once cannot double book. */
export async function addAppointment(v: AppointmentInput): Promise<SaveResult> {
  const clash = findConflicts(await overlapping(v.starts_at, v.ends_at), { starts_at: v.starts_at, ends_at: v.ends_at, status: "scheduled" });
  if (clash.length) return { ok: false, error: conflictText(clash) };
  try {
    const rows = await sql().query(`INSERT INTO appointments (type, service_code, starts_at, ends_at, price_cents) VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5::bigint) RETURNING id`, [v.type, v.service_code, iso(v.starts_at), iso(v.ends_at), v.price_cents]);
    const id = Number((rows as { id: string }[])[0].id);
    await audit("add_appointment", { id, type: v.type, service: v.service_code });
    return { ok: true, id };
  } catch (e) { if (isOverlapError(e)) return { ok: false, error: RACE }; throw e; }
}

/** Changes the time, length, type or service of an OPEN appointment. */
export async function updateAppointment(id: number, v: AppointmentInput): Promise<SaveResult> {
  const clash = findConflicts(await overlapping(v.starts_at, v.ends_at), { id, starts_at: v.starts_at, ends_at: v.ends_at, status: "scheduled" });
  if (clash.length) return { ok: false, error: conflictText(clash) };
  try {
    // The price may be corrected while the appointment is open, but never below what has already been received.
    const rows = await sql().query(`UPDATE appointments SET type = $2, service_code = $3, starts_at = $4::timestamptz, ends_at = $5::timestamptz, price_cents = $6::bigint, updated_at = now()
                                    WHERE id = $1::bigint AND status IN ('scheduled', 'confirmed')
                                      AND ($6::bigint IS NULL OR $6::bigint >= (SELECT coalesce(sum(amount_cents), 0) FROM appointment_payments WHERE appointment_id = $1::bigint)) RETURNING id`,
      [id, v.type, v.service_code, iso(v.starts_at), iso(v.ends_at), v.price_cents]);
    if (!rows.length) return { ok: false, error: "That appointment can no longer be edited, or the price is lower than what has already been received." };
    await audit("update_appointment", { id, type: v.type, service: v.service_code });
    return { ok: true, id };
  } catch (e) { if (isOverlapError(e)) return { ok: false, error: RACE }; throw e; }
}

/**
 * Moves an appointment to a new status. `from` must still be its current status, so a stale page cannot overwrite a newer change. Reinstating a canceled one re-checks for overlaps.
 * Completed is final, and an appointment can only BECOME completed through completeAppointment (which records its payment and supplies in the same transaction).
 */
export async function setAppointmentStatus(id: number, from: Status, to: Status, reason: CancelReason | null): Promise<SaveResult> {
  try {
    const rows = await sql().query(
      `UPDATE appointments SET status = $3, canceled_at = CASE WHEN $3 = 'canceled' THEN now() ELSE NULL END, cancel_reason = CASE WHEN $3 = 'canceled' THEN $4 ELSE NULL END, updated_at = now()
       WHERE id = $1::bigint AND status = $2 AND $2 <> 'completed' AND $3 <> 'completed' RETURNING id`, [id, from, to, to === "canceled" ? reason ?? "other" : null]);
    if (!rows.length) return { ok: false, error: "That appointment changed while you were looking at it. Open it again." };
    await audit("set_appointment_status", { id, status: to });
    return { ok: true, id };
  } catch (e) { if (isOverlapError(e)) return { ok: false, error: "That time is now taken by another appointment, so this one cannot be reinstated." }; throw e; }
}

// ---- Appointment money and supplies (schema version 11). Payments reuse income_entries; supplies reuse inventory movements; receivables are calculated, never stored. ----
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const paymentFrom = (r: Record<string, unknown>): AppointmentPayment => ({
  id: Number(r.id), appointment_id: Number(r.appointment_id), amount_cents: Number(r.amount_cents), method: r.method as AppointmentPayment["method"], paid_on: r.paid_on as string,
  income_entry_id: num(r.income_entry_id), reconcile_state: r.reconcile_state as AppointmentPayment["reconcile_state"], square_payment_id: (r.square_payment_id as string | null) ?? null,
});
const failure = (e: unknown): { ok: false; error: string } => { const t = dbErrorText((e as Error)?.message ?? ""); if (t) return { ok: false, error: t }; throw e; };

export async function listAppointmentPayments(appointmentId: number): Promise<AppointmentPayment[]> {
  const rows = await sql().query(`SELECT id, appointment_id, amount_cents, method, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, income_entry_id, reconcile_state, square_payment_id
                                  FROM appointment_payments WHERE appointment_id = $1::bigint ORDER BY paid_on, id`, [appointmentId]);
  return (rows as Record<string, unknown>[]).map(paymentFrom);
}

export interface SupplyUse { movement_id: number; item_id: number; label: string; unit: string; quantity: number; moved_on: string }
export async function listSupplyUses(appointmentId: number): Promise<SupplyUse[]> {
  const rows = await sql().query(`SELECT m.id AS movement_id, m.item_id, i.label, i.unit, m.quantity, to_char(m.moved_on, 'YYYY-MM-DD') AS moved_on
                                  FROM appointment_supply_uses u JOIN inventory_movements m ON m.id = u.movement_id JOIN inventory_items i ON i.id = m.item_id
                                  WHERE u.appointment_id = $1::bigint ORDER BY m.id`, [appointmentId]);
  return (rows as Record<string, unknown>[]).map((r) => ({ movement_id: Number(r.movement_id), item_id: Number(r.item_id), label: r.label as string, unit: r.unit as string, quantity: Number(r.quantity), moved_on: r.moved_on as string }));
}

/** One payment (an advance on an open appointment, or a payment against a receivable). Saved in one statement; a repeat of the same form key returns the first result. */
export async function recordAppointmentPayment(appointmentId: number, v: PaymentInput): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  try {
    const r = await sql().query(`SELECT record_appointment_payment($1::jsonb) AS id`, [JSON.stringify({ appointment_id: appointmentId, amount_cents: v.amount_cents, method: v.method, paid_on: v.paid_on, square_payment_id: v.square_payment_id, request_key: v.request_key })]);
    const id = Number((r as { id: string }[])[0].id);
    await audit("record_appointment_payment", { appointment: appointmentId, id, amount_cents: v.amount_cents, kind: v.method });
    return { ok: true, id };
  } catch (e) { return failure(e); }
}

export interface CompletionResult { ok: true; paymentId: number | null; items: { item_id: number; on_hand: number }[] }
/**
 * The single completion workflow. Validates supplies with the Inventory rules, then makes ONE database call (complete_appointment) that sets the price, records the payment,
 * takes the supplies out of stock and marks the appointment completed, all in one transaction. If anything fails nothing is saved. If stock changed in between, the supplies
 * are re-checked once automatically.
 */
export async function completeAppointment(appointmentId: number, v: CompletionInput, movedOn: string): Promise<CompletionResult | { ok: false; error: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const itemIds = v.supplies.map((s) => s.item_id);
    const found = itemIds.length ? await sql().query(`SELECT id, label FROM inventory_items WHERE id = ANY($1::bigint[])`, [itemIds]) : [];
    const histories = [];
    for (const it of found as { id: string; label: string }[]) histories.push({ id: Number(it.id), label: it.label, movements: await listMovements(Number(it.id)), lotUses: await listLotUses(Number(it.id)) });
    const plan = planSupplies(v.supplies, histories, movedOn);
    if (!plan.ok) return { ok: false, error: plan.error };
    try {
      const r = await sql().query(`SELECT complete_appointment($1::jsonb) AS result`, [JSON.stringify({
        appointment_id: appointmentId, price_cents: v.price_cents, payment: v.payment, supplies: plan.uses })]);
      const res = (typeof (r as { result: unknown }[])[0].result === "string" ? JSON.parse((r as { result: string }[])[0].result) : (r as { result: unknown }[])[0].result) as { payment_id: number | null; movements: { item_id: number; on_hand: number }[] };
      await audit("complete_appointment", { appointment: appointmentId, amount_cents: v.payment?.amount_cents ?? 0, rows: res.movements.length });
      if (v.payment) await audit("record_appointment_payment", { appointment: appointmentId, id: res.payment_id, amount_cents: v.payment.amount_cents, kind: v.payment.method });
      return { ok: true, paymentId: res.payment_id === null ? null : Number(res.payment_id), items: res.movements.map((m) => ({ item_id: Number(m.item_id), on_hand: Number(m.on_hand) })) };
    } catch (e) {
      if (dbErrorCode((e as Error)?.message ?? "") === "STALE_INVENTORY" && attempt === 0) continue;
      return failure(e);
    }
  }
  return { ok: false, error: "Inventory changed while you were working. Review the supplies and try again." };
}

export interface ReceivableRow { id: number; service_date: string; service: string; price_cents: number; paid_cents: number }
/** Completed appointments with their price and amount received. By default only those with a balance left. */
export async function listReceivables(includePaid = false): Promise<ReceivableRow[]> {
  const rows = await sql().query(
    `SELECT a.id, to_char(a.starts_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS service_date, s.label AS service, a.price_cents, coalesce(sum(p.amount_cents), 0)::bigint AS paid
     FROM appointments a JOIN appointment_services s ON s.code = a.service_code LEFT JOIN appointment_payments p ON p.appointment_id = a.id
     WHERE a.status = 'completed' AND a.price_cents IS NOT NULL
     GROUP BY a.id, s.label HAVING ($1::boolean OR a.price_cents > coalesce(sum(p.amount_cents), 0))
     ORDER BY a.starts_at, a.id`, [includePaid]);
  return (rows as Record<string, unknown>[]).map((r) => ({ id: Number(r.id), service_date: r.service_date as string, service: r.service as string, price_cents: Number(r.price_cents), paid_cents: Number(r.paid) }));
}

export interface AwaitingSquare { payment: AppointmentPayment; service_date: string }
export async function listAwaitingSquare(): Promise<AwaitingSquare[]> {
  const rows = await sql().query(`SELECT p.id, p.appointment_id, p.amount_cents, p.method, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on, p.income_entry_id, p.reconcile_state, p.square_payment_id,
                                         to_char(a.starts_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS service_date
                                  FROM appointment_payments p JOIN appointments a ON a.id = p.appointment_id WHERE p.reconcile_state = 'awaiting_square' ORDER BY p.paid_on, p.id`);
  return (rows as Record<string, unknown>[]).map((r) => ({ payment: paymentFrom(r), service_date: r.service_date as string }));
}

export interface SquareCandidate { id: number; occurred_on: string; gross_cents: number; tail: string }
/** Imported Square entries not yet linked to any appointment payment, for an EXPLICIT choice. Only entries with exactly the same revenue amount are offered; date is shown, never used to decide. */
export async function squareCandidates(paymentId: number): Promise<SquareCandidate[]> {
  const rows = await sql().query(
    `SELECT i.id, to_char(i.occurred_on, 'YYYY-MM-DD') AS occurred_on, i.gross_cents, right(i.external_id, 6) AS tail
     FROM income_entries i JOIN appointment_payments p ON p.id = $1::bigint
     WHERE p.reconcile_state = 'awaiting_square' AND i.source = 'square' AND i.external_id IS NOT NULL AND i.gross_cents = p.amount_cents
       AND NOT EXISTS (SELECT 1 FROM appointment_payments q WHERE q.income_entry_id = i.id) ORDER BY i.occurred_on DESC, i.id DESC LIMIT 20`, [paymentId]);
  return (rows as Record<string, unknown>[]).map((r) => ({ id: Number(r.id), occurred_on: r.occurred_on as string, gross_cents: Number(r.gross_cents), tail: r.tail as string }));
}

/** Links a waiting payment to an imported Square entry the user chose. Refused unless the entry is Square, unlinked, and has exactly the payment's revenue amount. */
export async function linkSquarePayment(paymentId: number, incomeEntryId: number): Promise<boolean> {
  const rows = await sql().query(
    `UPDATE appointment_payments p SET income_entry_id = e.id, reconcile_state = 'matched'
     FROM income_entries e WHERE p.id = $1::bigint AND p.reconcile_state = 'awaiting_square' AND e.id = $2::bigint AND e.source = 'square' AND e.external_id IS NOT NULL
       AND e.gross_cents = p.amount_cents AND NOT EXISTS (SELECT 1 FROM appointment_payments q WHERE q.income_entry_id = e.id) RETURNING p.id`, [paymentId, incomeEntryId]);
  if (rows.length) await audit("link_square_payment", { id: paymentId });
  return rows.length > 0;
}

/** After a Square import: link waiting payments whose Square payment ID exactly equals an imported entry's ID (and amount). Nothing is matched by amount and date. */
export async function reconcileSquareAuto(): Promise<number> {
  const rows = await sql().query(
    `UPDATE appointment_payments p SET income_entry_id = e.id, reconcile_state = 'matched'
     FROM income_entries e WHERE p.reconcile_state = 'awaiting_square' AND p.square_payment_id IS NOT NULL AND e.source = 'square' AND e.external_id = p.square_payment_id
       AND e.gross_cents = p.amount_cents AND NOT EXISTS (SELECT 1 FROM appointment_payments q WHERE q.income_entry_id = e.id) RETURNING p.id`);
  if (rows.length) await audit("link_square_payment", { rows: rows.length });
  return rows.length;
}

/** Totals for the Overview: expected revenue on open appointments and receivables on completed ones (calculated, nothing stored). */
export async function financeTotals(): Promise<{ expectedCents: number; receivableCents: number; receivableCount: number; awaitingSquare: number }> {
  const r = (await sql()`
    WITH t AS (SELECT a.status, a.price_cents, coalesce((SELECT sum(p.amount_cents) FROM appointment_payments p WHERE p.appointment_id = a.id), 0) AS paid FROM appointments a WHERE a.price_cents IS NOT NULL AND a.status IN ('scheduled', 'confirmed', 'completed'))
    SELECT coalesce(sum(greatest(price_cents - paid, 0)) FILTER (WHERE status IN ('scheduled', 'confirmed')), 0)::bigint AS expected,
           coalesce(sum(greatest(price_cents - paid, 0)) FILTER (WHERE status = 'completed'), 0)::bigint AS receivable,
           count(*) FILTER (WHERE status = 'completed' AND price_cents > paid)::int AS rcount,
           (SELECT count(*) FROM appointment_payments WHERE reconcile_state = 'awaiting_square')::int AS awaiting FROM t`)[0];
  return { expectedCents: Number(r.expected), receivableCents: Number(r.receivable), receivableCount: Number(r.rcount), awaitingSquare: Number(r.awaiting) };
}
