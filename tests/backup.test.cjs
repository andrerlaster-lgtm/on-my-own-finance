const test = require("node:test"), assert = require("node:assert/strict");
const F = require("../.testbuild/backupFormat.js"), S = require("../.testbuild/schema.js");

// synthetic rows only
const jpeg = (n) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, n, 0xff, 0xd9]);
const data = () => ({
  tables: {
    app_meta: [{ key: "schema_version", value: String(S.SCHEMA_VERSION) }],
    income_entries: [{ id: 1, gross_cents: 10000, tip_cents: 1500, fee_cents: 350, visits: 1 }, { id: 2, gross_cents: 5000, tip_cents: 0, fee_cents: 0, visits: 0 }],
    expenses: [{ id: 1, amount_cents: 2499 }, { id: 2, amount_cents: 1000 }],
    expense_receipts: [{ id: 5, expense_id: 1, bytes_len: 7 }, { id: 6, expense_id: 1, bytes_len: 7 }],
    mileage_trips: [{ id: 1, miles_tenths: 184 }],
    inventory_movements: [{ id: 1, kind: "purchase", quantity: 10, unit_cost_cents: 500 }, { id: 2, kind: "use", quantity: 4, unit_cost_cents: null }],
    tax_payments: [{ id: 1, amount_cents: 10000 }],
  },
  receipts: new Map([[5, jpeg(1)], [6, jpeg(2)]]),
});
const make = () => { const d = data(); return F.buildBackup({ schema_version: S.SCHEMA_VERSION, created_at: "2026-10-24T00:00:00Z", tables: d.tables, receipts: d.receipts }); };
const reader = (files) => (rel) => files.get(rel) ?? null;

test("a fresh backup verifies, and its totals match the data", () => {
  const { manifest, files } = make();
  const v = F.verifyBackup(reader(files), S.SCHEMA_VERSION);
  assert.deepEqual(v.problems, []); assert.equal(v.ok, true);
  assert.equal(manifest.checks.income_receipts_cents, 16500); assert.equal(manifest.checks.expenses_cents, 3499); assert.equal(manifest.checks.inventory_bought_cents, 5000);
  assert.equal(manifest.checks.inventory_units_out, 4); assert.equal(manifest.checks.receipt_bytes, 14); assert.equal(manifest.checks["rows:income_entries"], 2);
  for (const t of S.EXPORT_TABLES) assert.ok(files.has(`tables/${t}.ndjson`), t);
});

test("every exported table is in the restore order, parents first", () => {
  assert.deepEqual([...F.RESTORE_ORDER].sort(), [...S.EXPORT_TABLES].sort());
  const at = (t) => F.RESTORE_ORDER.indexOf(t);
  for (const [child, parent] of [["income_entries", "import_batches"], ["income_entry_payers", "income_entries"], ["income_entry_payers", "payers"], ["expense_receipts", "expenses"], ["inventory_movements", "inventory_items"], ["inventory_lot_uses", "inventory_movements"], ["inventory_settings", "inventory_items"], ["form_1099_entries", "payers"]]) assert.ok(at(parent) < at(child), `${parent} before ${child}`);
});

test("damage and tampering are caught", () => {
  const problems = (mutate) => { const { files } = make(); mutate(files); return F.verifyBackup(reader(files), S.SCHEMA_VERSION).problems.join(" | "); };
  assert.match(problems((f) => f.set("tables/expenses.ndjson", '{"id":1,"amount_cents":1}\n')), /changed or damaged/);
  assert.match(problems((f) => f.delete("tables/income_entries.ndjson")), /is missing/);
  assert.match(problems((f) => f.delete("receipts/5.jpg")), /Receipt photo receipts\/5\.jpg is missing/);
  assert.match(problems((f) => f.set("receipts/6.jpg", jpeg(9))), /Receipt photo receipts\/6\.jpg has been changed/);
  assert.match(problems((f) => f.delete("manifest.json")), /manifest\.json is missing/);
  assert.match(problems((f) => f.set("manifest.json", "{not json")), /manifest\.json is missing or not readable/);
  assert.match(problems((f) => { const m = JSON.parse(f.get("manifest.json")); m.app = "other"; f.set("manifest.json", JSON.stringify(m)); }), /not an On My Own Finance backup/);
  assert.match(problems((f) => { const m = JSON.parse(f.get("manifest.json")); m.schema_version = 999; f.set("manifest.json", JSON.stringify(m)); }), /newer version/);
  assert.match(problems((f) => { const m = JSON.parse(f.get("manifest.json")); m.checks.income_receipts_cents += 1; f.set("manifest.json", JSON.stringify(m)); }), /Totals do not match/);
  assert.match(problems((f) => { const m = JSON.parse(f.get("manifest.json")); m.tables.expenses.rows = 9; f.set("manifest.json", JSON.stringify(m)); }), /manifest says 9/);
});

test("a receipt whose expense is not in the backup is refused", () => {
  const d = data(); d.tables.expenses = [{ id: 2, amount_cents: 1000 }];
  const { files } = F.buildBackup({ schema_version: S.SCHEMA_VERSION, created_at: "x", tables: d.tables, receipts: d.receipts });
  assert.match(F.verifyBackup(reader(files), S.SCHEMA_VERSION).problems.join(), /belongs to expense 1/);
  assert.throws(() => F.buildBackup({ schema_version: 1, created_at: "x", tables: data().tables, receipts: new Map() }), /no bytes/);
});

test("scripts: refuse to overwrite, never restore into a table that has rows, and keep backups out of git", () => {
  const fs = require("node:fs"), path = require("node:path"), root = path.join(__dirname, "..");
  const rd = (p) => fs.readFileSync(path.join(root, p), "utf8");
  assert.match(rd("scripts/backup.cjs"), /already has files/); assert.match(rd("scripts/restore-backup.cjs"), /Refusing to restore/);
  assert.match(rd("scripts/restore-backup.cjs"), /verifyBackup/, "a backup is verified before anything is written");
  assert.match(rd(".gitignore"), /backups\//);
  const pkg = JSON.parse(rd("package.json")); for (const s of ["backup", "verify-backup", "restore-backup"]) assert.ok(pkg.scripts[s], s);
});
