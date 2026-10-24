// Loads a backup into an EMPTY database: node scripts/restore-backup.cjs <folder>   (DATABASE_URL = the empty target)
// Never use this on the live database. Create a new empty Neon branch/database, restore there, and check the totals.
// It creates the tables, refuses to continue if any table already has rows, restores in dependency order, then re-reads the
// database and compares every total and receipt checksum with the backup.
const fs = require("node:fs"), path = require("node:path");
const { neon } = require("@neondatabase/serverless");
const F = require("../.testbuild/backupFormat.js"), S = require("../.testbuild/schema.js");

const json = (v) => (typeof v === "string" ? JSON.parse(v) : v);
(async () => {
  const dir = process.argv[2];
  if (!dir) { console.error("Usage: npm run restore-backup -- <folder>"); process.exit(2); }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set (point it at an EMPTY database)."); process.exit(2); }
  const read = (rel) => { try { return fs.readFileSync(path.join(dir, rel)); } catch { return null; } };
  const v = F.verifyBackup(read, S.SCHEMA_VERSION);
  if (!v.ok) { console.error("The backup did not pass verification, nothing was restored:\n- " + v.problems.join("\n- ")); process.exit(1); }
  const sql = neon(process.env.DATABASE_URL);
  for (const stmt of S.schemaStatements) await sql.query(stmt);
  for (const name of S.EXPORT_TABLES) {
    if (name === "app_meta") continue;
    const n = Number((await sql.query(`SELECT count(*) AS n FROM ${name}`))[0].n);
    if (n > 0) { console.error(`Refusing to restore: ${name} already has ${n} rows. Use a new empty database.`); process.exit(1); }
  }
  for (const name of F.RESTORE_ORDER) {
    const rows = v.tables[name] ?? [];
    if (name === "expense_receipts") {
      for (const r of rows) {
        const bytes = read(F.receiptFile(r.id));
        await sql.query("INSERT INTO expense_receipts (id, expense_id, content_type, bytes_len, data, created_at) VALUES ($1, $2, $3, $4, decode($5, 'base64'), $6)", [r.id, r.expense_id, r.content_type, r.bytes_len, Buffer.from(bytes).toString("base64"), r.created_at]);
      }
    } else if (name === "app_meta") {
      for (const r of rows) await sql.query("INSERT INTO app_meta (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at", [r.key, r.value, r.updated_at]);
    } else {
      for (let i = 0; i < rows.length; i += 200) await sql.query(`INSERT INTO ${name} SELECT * FROM jsonb_populate_recordset(NULL::${name}, $1::jsonb)`, [JSON.stringify(rows.slice(i, i + 200))]);
    }
    if (!["app_meta", "tax_year_rules", "income_entry_payers", "inventory_settings"].includes(name)) {
      await sql.query(`SELECT setval(pg_get_serial_sequence('${name}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${name}`);
    }
  }
  const back = {};
  for (const name of S.EXPORT_TABLES) back[name] = (await sql.query(`SELECT to_jsonb(t)${name === "expense_receipts" ? " - 'data'" : ""} AS j FROM ${name} t`)).map((r) => json(r.j));
  const problems = F.compareChecks(v.manifest.checks, F.checksFromRows(back));
  for (const r of v.manifest.receipts) {
    const h = (await sql.query("SELECT encode(sha256(data), 'hex') AS h FROM expense_receipts WHERE id = $1", [r.id]))[0]?.h;
    if (h !== r.sha256) problems.push(`receipt ${r.id}: stored photo differs from the backup`);
  }
  if (problems.length) { console.error("RESTORE CHECK FAILED:\n- " + problems.join("\n- ")); process.exit(1); }
  console.log(`Restored and checked: ${Object.values(v.manifest.tables).reduce((s, t) => s + t.rows, 0)} rows, ${v.manifest.receipts.length} receipt photos. Every total and checksum matches the backup.`);
})().catch((e) => { console.error("Restore failed:", e.message); process.exit(1); });
