const test = require("node:test"), assert = require("node:assert/strict");
const S = require("../.testbuild/schema.js");

test("every statement is additive and re-runnable", () => {
  for (const s of S.schemaStatements) {
    // The only ALTER allowed is adding a column that may already exist (nothing is changed, dropped or rewritten).
    if (/^\s*ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check, ADD CONSTRAINT expenses_category_check CHECK/.test(s)) continue; // version 9, covered by its own test
    assert.match(s, /^\s*(CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS|INSERT INTO (app_meta|accounts)|ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS )/);
    assert.doesNotMatch(s.replace(/^\s*ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS/i, ""), /\b(DROP|TRUNCATE|DELETE|ALTER)\b/i);
  }
  assert.match(S.schemaStatements.at(-1), /ON CONFLICT/);
});
test("no column can hold patient or client identity", () => {
  const cols = S.schemaStatements.join("\n").split("\n").map((l) => l.trim().split(/\s+/)[0].toLowerCase());
  for (const bad of ["name", "patient", "client", "customer", "email", "phone", "address", "dob", "birth", "diagnosis", "note", "notes", "memo"]) {
    assert.ok(!cols.some((c) => c === bad || c.startsWith(bad + "_") || c.endsWith("_" + bad)), `column like ${bad}`);
  }
});
test("export lists only tables that exist in the schema", () => {
  for (const t of S.EXPORT_TABLES) assert.match(S.schemaStatements.join("\n"), new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
});

test("version 7 adds only new accounting tables, seeds the chart once and never touches existing tables", () => {
  assert.ok(S.SCHEMA_VERSION >= 7);
  const v7 = S.schemaStatements.join("\n");
  for (const t of ["accounts", "expense_category_accounts", "expense_accounts", "income_accounts", "inventory_item_accounts", "journal_entries", "journal_lines"]) { assert.match(v7, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`)); assert.ok(S.EXPORT_TABLES.includes(t), `${t} is in the export`); }
});
test("version 6 only adds the optional July 1 mileage rate columns", () => {
  assert.ok(S.SCHEMA_VERSION >= 6);
  const v6 = S.schemaStatements.filter((s) => /mileage_rate_h2/.test(s));
  assert.equal(v6.length, 2);
  for (const s of v6) assert.match(s, /^ALTER TABLE tax_year_rules ADD COLUMN IF NOT EXISTS/);
  assert.equal(S.schemaStatements.filter((s) => /^\s*ALTER TABLE tax_year_rules/i.test(s)).length, 2, "only these two tax_year_rules ALTER statements exist");
});

test("version 8: temporary trip stops expire, are capped, and are never exported or backed up", () => {
  assert.ok(S.SCHEMA_VERSION >= 8);
  const sql = S.schemaStatements.find((x) => /CREATE TABLE IF NOT EXISTS mileage_pending/.test(x));
  assert.ok(sql); assert.match(sql, /expires_at\s+timestamptz NOT NULL/); assert.match(sql, /char_length\(start_text\) BETWEEN 1 AND 120/);
  assert.ok(!S.EXPORT_TABLES.includes("mileage_pending"), "stops must never reach an export or backup file");
});

test("version 9: the gas category widens one CHECK list atomically, keeps every old category, and touches no rows", () => {
  const E = require("../.testbuild/expenses.js");
  assert.ok(S.SCHEMA_VERSION >= 9);
  const alters = S.schemaStatements.filter((s) => /^\s*ALTER TABLE expenses/i.test(s));
  assert.equal(alters.length, 1);
  assert.doesNotMatch(alters[0], /\b(UPDATE|DELETE|TRUNCATE|DROP TABLE|DROP COLUMN)\b/i);
  for (const c of E.CATEGORIES) { assert.ok(alters[0].includes(`'${c.id}'`), `${c.id} stays allowed`); assert.ok(S.schemaStatements.find((s) => /CREATE TABLE IF NOT EXISTS expenses\b/.test(s)).includes(`'${c.id}'`), `${c.id} on fresh installs`); }
  assert.ok(alters[0].includes("'vehicle_fuel'"));
  assert.equal(S.schemaStatements.filter((s) => /\bDROP (CONSTRAINT|TABLE|COLUMN|INDEX)\b/.test(s)).length, 1, "the only DROP is the one inside the atomic ALTER");
  const acct = S.schemaStatements.find((s) => /INSERT INTO accounts/.test(s));
  assert.match(acct, /WHERE EXISTS \(SELECT 1 FROM accounts\)/, "only added to an existing chart (a fresh chart is seeded by the app)");
});
test("gas can be entered as an expense and has its own account", () => {
  const E = require("../.testbuild/expenses.js"), A = require("../.testbuild/accounts.js");
  const r = E.parseExpenseForm({ spent_on: "2026-11-02", amount: "42.10", category: "vehicle_fuel", vendor: "Shell" });
  assert.equal(r.ok, true); assert.equal(r.value.category, "vehicle_fuel");
  assert.ok(A.DEFAULT_ACCOUNTS.some((a) => a.key === "cat:vehicle_fuel" && a.type === "operating_expense"));
});
