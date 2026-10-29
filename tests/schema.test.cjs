const test = require("node:test"), assert = require("node:assert/strict");
const S = require("../.testbuild/schema.js");

test("every statement is additive and re-runnable", () => {
  for (const s of S.schemaStatements) {
    // The only ALTER allowed is adding a column that may already exist (nothing is changed, dropped or rewritten).
    assert.match(s, /^\s*(CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS|INSERT INTO app_meta|ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS )/);
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
  assert.ok(S.schemaStatements.filter((s) => /^\s*ALTER/i.test(s)).length >= 2);
});

test("version 8: temporary trip stops expire, are capped, and are never exported or backed up", () => {
  assert.ok(S.SCHEMA_VERSION >= 8);
  const sql = S.schemaStatements.find((x) => /CREATE TABLE IF NOT EXISTS mileage_pending/.test(x));
  assert.ok(sql); assert.match(sql, /expires_at\s+timestamptz NOT NULL/); assert.match(sql, /char_length\(start_text\) BETWEEN 1 AND 120/);
  assert.ok(!S.EXPORT_TABLES.includes("mileage_pending"), "stops must never reach an export or backup file");
});

test("version 9: mileage details are added as optional/defaulted columns, edits are kept, and old rows stay valid", () => {
  assert.equal(S.SCHEMA_VERSION, 9);
  const alters = S.schemaStatements.filter((x) => /^\s*ALTER TABLE mileage_trips/.test(x));
  assert.equal(alters.length, 9);
  for (const a of alters) assert.match(a, /ADD COLUMN IF NOT EXISTS \w+ [^,]*(DEFAULT|CHECK \(\w+ IS NULL|timestamptz$)/, a);
  const all = S.schemaStatements.join("\n");
  assert.match(all, /category\s+text NOT NULL DEFAULT 'business'/);
  assert.match(all, /miles_status text NOT NULL DEFAULT 'actual'/);
  for (const t of ["mileage_trip_edits", "mileage_favorites"]) assert.ok(S.EXPORT_TABLES.includes(t), t);
});
