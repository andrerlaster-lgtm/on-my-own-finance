const test = require("node:test"), assert = require("node:assert/strict");
const S = require("../.testbuild/schema.js");

test("every statement is additive and re-runnable", () => {
  for (const s of S.schemaStatements) {
    assert.match(s, /^\s*(CREATE TABLE IF NOT EXISTS|INSERT INTO app_meta)/);
    assert.doesNotMatch(s, /\b(DROP|TRUNCATE|DELETE|ALTER)\b/i);
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
