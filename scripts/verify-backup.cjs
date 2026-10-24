// Checks a backup folder without touching any database: node scripts/verify-backup.cjs <folder>
const fs = require("node:fs"), path = require("node:path");
const F = require("../.testbuild/backupFormat.js"), S = require("../.testbuild/schema.js");
const dir = process.argv[2];
if (!dir) { console.error("Usage: npm run verify-backup -- <folder>"); process.exit(2); }
const v = F.verifyBackup((rel) => { try { return fs.readFileSync(path.join(dir, rel)); } catch { return null; } }, S.SCHEMA_VERSION);
if (!v.ok) { console.error("BACKUP PROBLEMS:\n- " + v.problems.join("\n- ")); process.exit(1); }
console.log(`OK: backup from ${v.manifest.created_at} (schema ${v.manifest.schema_version}), ${Object.values(v.manifest.tables).reduce((s, t) => s + t.rows, 0)} rows, ${v.manifest.receipts.length} receipt photos. Every checksum and total matches.`);
