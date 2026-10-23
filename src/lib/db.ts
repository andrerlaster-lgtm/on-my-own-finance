import { neon } from "@neondatabase/serverless";
import { EXPORT_TABLES, schemaStatements, SCHEMA_VERSION, type ExportTable } from "./schema";
import { emptyRules, type TaxYearRules } from "./taxRules";
import type { Counts, ImportRow } from "./squareImport";
import type { IncomeEntry, IncomeInput, TaxForm } from "./income";
import type { ItemInput, Movement, MovementInput } from "./inventory";
import { replay, checkAdd, type Stock } from "./inventory";

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
  const order = table === "app_meta" ? "key" : table === "tax_year_rules" ? "tax_year" : "id";
  return (await sql().query(`SELECT * FROM ${table} ORDER BY ${order}`)) as Record<string, unknown>[];
}

// ---- Phase 1: income and inventory. Dates are read as text (to_char) and bigint sums as numbers so nothing shifts or overflows. ----

export async function listIncome(from: string, to: string, limit = 500): Promise<IncomeEntry[]> {
  const rows = await sql()`
    SELECT id, to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on, source, tax_form, gross_cents, tip_cents, fee_cents, visits, (external_id IS NOT NULL) AS imported
    FROM income_entries WHERE occurred_on BETWEEN ${from}::date AND ${to}::date ORDER BY occurred_on DESC, id DESC LIMIT ${limit}`;
  return rows.map((r) => ({ id: Number(r.id), occurred_on: r.occurred_on, source: r.source, tax_form: r.tax_form as TaxForm, gross_cents: Number(r.gross_cents), tip_cents: Number(r.tip_cents), fee_cents: Number(r.fee_cents), visits: Number(r.visits), imported: r.imported === true || r.imported === "t" || r.imported === "true" }));
}

export async function addIncome(v: IncomeInput): Promise<void> {
  await sql()`INSERT INTO income_entries (occurred_on, source, tax_form, gross_cents, tip_cents, fee_cents, visits)
              VALUES (${v.occurred_on}::date, ${v.source}, ${v.tax_form}, ${v.gross_cents}, ${v.tip_cents}, ${v.fee_cents}, ${v.visits})`;
  await audit("add_income", { occurred_on: v.occurred_on, source: v.source });
}

/** Visits can be set or corrected on any entry, including imported ones. */
export async function setVisits(id: number, visits: number): Promise<void> {
  const rows = await sql()`UPDATE income_entries SET visits = ${visits} WHERE id = ${id} RETURNING id`;
  if (rows.length) await audit("set_visits", { id, visits });
}

/** Only hand-entered rows can be deleted; imported rows are removed by re-importing, never here. */
export async function deleteManualIncome(id: number): Promise<boolean> {
  const rows = await sql()`DELETE FROM income_entries WHERE id = ${id} AND external_id IS NULL RETURNING id`;
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

/** Appends one movement after replaying the whole history with it included. Returns an error message instead of saving if stock would go negative. */
export async function addMovement(v: MovementInput): Promise<string | null> {
  if (!(await getItem(v.item_id))) return "Item not found.";
  const err = checkAdd(await listMovements(v.item_id), v);
  if (err) return err;
  await sql()`INSERT INTO inventory_movements (item_id, moved_on, kind, quantity, unit_cost_cents, reason, lot_number, expires_on)
              VALUES (${v.item_id}, ${v.moved_on}::date, ${v.kind}, ${v.quantity}, ${v.unit_cost_cents}, ${v.reason}, ${v.lot_number}, ${v.expires_on}::date)`;
  await audit("add_movement", { item_id: v.item_id, kind: v.kind, quantity: v.quantity });
  return null;
}
