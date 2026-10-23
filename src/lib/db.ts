import { neon } from "@neondatabase/serverless";
import { EXPORT_TABLES, schemaStatements, SCHEMA_VERSION, type ExportTable } from "./schema";
import { emptyRules, type TaxYearRules } from "./taxRules";

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
  const order = table === "audit_log" ? "id" : table === "tax_year_rules" ? "tax_year" : "key";
  return (await sql().query(`SELECT * FROM ${table} ORDER BY ${order}`)) as Record<string, unknown>[];
}
