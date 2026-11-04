// Full backup to a local folder: node scripts/backup.cjs <folder>   (needs DATABASE_URL; run via `npm run backup -- <folder>`)
// Reads straight from the database, so it is not limited by web response sizes. Writes tables, receipt photos and a checksummed manifest,
// then verifies what it wrote. The folder holds financial data: keep it on an encrypted disk, never in git.
const fs = require("node:fs"), path = require("node:path");
const { neon } = require("@neondatabase/serverless");
const F = require("../.testbuild/backupFormat.js"), S = require("../.testbuild/schema.js");

const json = (v) => (typeof v === "string" ? JSON.parse(v) : v);
(async () => {
  const dir = process.argv[2];
  if (!dir) { console.error("Usage: npm run backup -- <new folder>"); process.exit(2); }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set."); process.exit(2); }
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) { console.error(`${dir} already has files. Choose a new folder.`); process.exit(2); }
  const sql = neon(process.env.DATABASE_URL);
  const version = Number((await sql.query("SELECT value FROM app_meta WHERE key = 'schema_version'"))[0]?.value ?? 0);
  if (version !== S.SCHEMA_VERSION) { console.error(`Database schema is ${version}, this app expects ${S.SCHEMA_VERSION}. Update the database first.`); process.exit(2); }
  const tables = {};
  for (const name of S.EXPORT_TABLES) {
    const order = S.EXPORT_ORDER[name] ?? "id", drop = name === "expense_receipts" ? " - 'data'" : "";
    tables[name] = (await sql.query(`SELECT to_jsonb(t)${drop} AS j FROM ${name} t ORDER BY ${order}`)).map((r) => json(r.j));
  }
  const receipts = new Map();
  for (const r of tables.expense_receipts) {
    const row = (await sql.query("SELECT encode(data, 'base64') AS b64, encode(sha256(data), 'hex') AS h FROM expense_receipts WHERE id = $1", [r.id]))[0];
    const bytes = Buffer.from(row.b64, "base64");
    if (F.sha256(bytes) !== row.h) throw new Error(`Receipt ${r.id} was damaged in transit; try again.`);
    receipts.set(r.id, bytes);
  }
  const { files } = F.buildBackup({ schema_version: version, created_at: new Date().toISOString(), tables, receipts });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const [rel, body] of files) { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 }); fs.writeFileSync(p, body, { mode: 0o600 }); }
  const v = F.verifyBackup((rel) => { try { return fs.readFileSync(path.join(dir, rel)); } catch { return null; } }, S.SCHEMA_VERSION);
  if (!v.ok) { console.error("BACKUP FAILED VERIFICATION:\n- " + v.problems.join("\n- ")); process.exit(1); }
  console.log(`Backup saved to ${dir}: ${Object.values(v.manifest.tables).reduce((s, t) => s + t.rows, 0)} rows, ${v.manifest.receipts.length} receipt photos. Verified.`);
})().catch((e) => { console.error("Backup failed:", e.message); process.exit(1); });
