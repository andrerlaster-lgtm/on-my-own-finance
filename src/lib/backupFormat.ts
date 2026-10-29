import { createHash } from "node:crypto";
import { EXPORT_TABLES } from "./schema";

/*
 * Backup folder format, shared by the backup, verify and restore commands. Pure: it works on rows and bytes it is given.
 *   manifest.json            what was saved, with a checksum for every file and totals to compare after a restore
 *   tables/<name>.ndjson     one JSON row per line (dates as text exactly as the database prints them)
 *   receipts/<id>.jpg        the receipt photos, byte for byte
 * Backups hold financial data and receipt photos: keep them on an encrypted disk, never in the repository.
 */
export const FORMAT_VERSION = 1;
export const APP_NAME = "on-my-own-finance";

/** Parents before children, so foreign keys hold while restoring. Every exported table must be listed (a test checks). */
export const RESTORE_ORDER = [
  "app_meta", "tax_year_rules", "audit_log", "import_batches", "payers", "income_entries", "income_entry_payers", "expenses", "expense_receipts",
  "mileage_trips", "inventory_items", "inventory_movements", "inventory_lot_uses", "inventory_settings", "form_1099_entries", "tax_payments", "tax_snapshots",
  "accounts", "expense_category_accounts", "expense_accounts", "income_accounts", "inventory_item_accounts", "journal_entries", "journal_lines", "mileage_trip_edits", "mileage_favorites",
] as const;

export type Row = Record<string, unknown>;
export const sha256 = (b: Uint8Array | string): string => createHash("sha256").update(b).digest("hex");

export interface TableEntry { rows: number; file: string; sha256: string }
export interface ReceiptEntry { id: number; expense_id: number; bytes: number; sha256: string; file: string }
export interface Manifest {
  format: number; app: string; schema_version: number; created_at: string;
  tables: Record<string, TableEntry>; receipts: ReceiptEntry[]; checks: Record<string, number>;
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
const sum = (rows: readonly Row[] | undefined, f: (r: Row) => number): number => (rows ?? []).reduce((s, r) => s + f(r), 0);

/** Row counts and key money totals. Computed the same way at backup time, from the backup file, and after a restore. */
export function checksFromRows(t: Record<string, readonly Row[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of EXPORT_TABLES) out[`rows:${name}`] = (t[name] ?? []).length;
  out.income_receipts_cents = sum(t.income_entries, (r) => num(r.gross_cents) + num(r.tip_cents));
  out.income_fees_cents = sum(t.income_entries, (r) => num(r.fee_cents));
  out.income_visits = sum(t.income_entries, (r) => num(r.visits));
  out.expenses_cents = sum(t.expenses, (r) => num(r.amount_cents));
  out.mileage_tenths = sum(t.mileage_trips, (r) => num(r.miles_tenths));
  out.inventory_bought_cents = sum((t.inventory_movements ?? []).filter((r) => r.kind === "purchase" || r.kind === "opening"), (r) => num(r.quantity) * num(r.unit_cost_cents));
  out.inventory_units_in = sum((t.inventory_movements ?? []).filter((r) => r.kind === "purchase" || r.kind === "opening" || r.kind === "adjust_up"), (r) => num(r.quantity));
  out.inventory_units_out = sum((t.inventory_movements ?? []).filter((r) => r.kind === "use" || r.kind === "adjust_down"), (r) => num(r.quantity));
  out.form_1099_cents = sum(t.form_1099_entries, (r) => num(r.amount_cents));
  out.tax_payments_cents = sum(t.tax_payments, (r) => num(r.amount_cents));
  out.receipt_bytes = sum(t.expense_receipts, (r) => num(r.bytes_len));
  return out;
}

export function compareChecks(expected: Record<string, number>, actual: Record<string, number>): string[] {
  const bad: string[] = [];
  for (const k of new Set([...Object.keys(expected), ...Object.keys(actual)])) if (expected[k] !== actual[k]) bad.push(`${k}: backup says ${expected[k]}, found ${actual[k]}`);
  return bad;
}

export const tableFile = (name: string) => `tables/${name}.ndjson`;
export const receiptFile = (id: number) => `receipts/${id}.jpg`;
export const toNdjson = (rows: readonly Row[]): string => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
export const parseNdjson = (text: string): Row[] => text.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Row);

/** Builds every file of a backup in memory. `receipts` maps a receipt id to its bytes; `t.expense_receipts` rows carry the metadata (no bytes). */
export function buildBackup(args: { schema_version: number; created_at: string; tables: Record<string, readonly Row[]>; receipts: ReadonlyMap<number, Uint8Array> }): { manifest: Manifest; files: Map<string, Uint8Array | string> } {
  const files = new Map<string, Uint8Array | string>();
  const tables: Record<string, TableEntry> = {};
  for (const name of EXPORT_TABLES) {
    const rows = args.tables[name] ?? [], body = toNdjson(rows);
    files.set(tableFile(name), body); tables[name] = { rows: rows.length, file: tableFile(name), sha256: sha256(body) };
  }
  const receipts: ReceiptEntry[] = [];
  for (const r of args.tables.expense_receipts ?? []) {
    const id = num(r.id), bytes = args.receipts.get(id);
    if (!bytes) throw new Error(`receipt ${id} has no bytes`);
    files.set(receiptFile(id), bytes); receipts.push({ id, expense_id: num(r.expense_id), bytes: bytes.length, sha256: sha256(bytes), file: receiptFile(id) });
  }
  const manifest: Manifest = { format: FORMAT_VERSION, app: APP_NAME, schema_version: args.schema_version, created_at: args.created_at, tables, receipts, checks: checksFromRows(args.tables) };
  files.set("manifest.json", JSON.stringify(manifest, null, 2));
  return { manifest, files };
}

export function validateManifest(m: unknown): string | null {
  const x = m as Partial<Manifest> | null;
  if (!x || typeof x !== "object") return "manifest.json is not readable.";
  if (x.app !== APP_NAME) return "This is not an On My Own Finance backup.";
  if (x.format !== FORMAT_VERSION) return `Backup format ${String(x.format)} is not supported (expected ${FORMAT_VERSION}).`;
  if (!Number.isInteger(x.schema_version) || !x.tables || !Array.isArray(x.receipts) || !x.checks) return "manifest.json is incomplete.";
  return null;
}

export type FileReader = (rel: string) => Uint8Array | string | null;
const asBytes = (v: Uint8Array | string) => (typeof v === "string" ? Buffer.from(v) : v);

/** Checks a backup without touching any database: every file present and unaltered, counts and totals consistent, receipts tie to expenses. */
export function verifyBackup(read: FileReader, appSchemaVersion: number): { ok: boolean; problems: string[]; manifest: Manifest | null; tables: Record<string, Row[]> } {
  const problems: string[] = [], tables: Record<string, Row[]> = {};
  const raw = read("manifest.json");
  let manifest: Manifest | null = null;
  try { manifest = raw === null ? null : (JSON.parse(Buffer.from(asBytes(raw)).toString("utf8")) as Manifest); } catch { manifest = null; }
  const bad = manifest ? validateManifest(manifest) : "manifest.json is missing or not readable.";
  if (bad || !manifest) return { ok: false, problems: [bad ?? "manifest.json is missing."], manifest: null, tables };
  if (manifest.schema_version > appSchemaVersion) problems.push(`This backup is from a newer version of the app (schema ${manifest.schema_version}, this app is ${appSchemaVersion}).`);
  for (const name of EXPORT_TABLES) {
    const e = manifest.tables[name];
    if (!e) { problems.push(`Table ${name} is missing from the backup.`); continue; }
    const body = read(e.file);
    if (body === null) { problems.push(`File ${e.file} is missing.`); continue; }
    if (sha256(asBytes(body)) !== e.sha256) { problems.push(`File ${e.file} has been changed or damaged (checksum differs).`); continue; }
    try { tables[name] = parseNdjson(Buffer.from(asBytes(body)).toString("utf8")); } catch { problems.push(`File ${e.file} has a row that is not valid JSON.`); continue; }
    if (tables[name].length !== e.rows) problems.push(`Table ${name} has ${tables[name].length} rows but the manifest says ${e.rows}.`);
  }
  const ids = new Set((tables.expenses ?? []).map((r) => num(r.id)));
  if (manifest.receipts.length !== (tables.expense_receipts ?? []).length) problems.push(`The backup lists ${manifest.receipts.length} receipt photos but the receipts table has ${(tables.expense_receipts ?? []).length} rows.`);
  for (const r of manifest.receipts) {
    const b = read(r.file);
    if (b === null) { problems.push(`Receipt photo ${r.file} is missing.`); continue; }
    const bytes = asBytes(b);
    if (bytes.length !== r.bytes || sha256(bytes) !== r.sha256) problems.push(`Receipt photo ${r.file} has been changed or damaged.`);
    if (!ids.has(r.expense_id)) problems.push(`Receipt photo ${r.id} belongs to expense ${r.expense_id}, which is not in the backup.`);
  }
  if (!problems.length) {
    const mismatches = compareChecks(manifest.checks, checksFromRows({ ...tables }));
    for (const m of mismatches) problems.push(`Totals do not match the data: ${m}.`);
  }
  return { ok: problems.length === 0, problems, manifest, tables };
}
