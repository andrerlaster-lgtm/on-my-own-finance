const test = require("node:test"), assert = require("node:assert/strict");
const R = require("../.testbuild/taxRules.js"), C = require("../.testbuild/csv.js");

test("empty form = nothing set, nothing confirmed", () => {
  const r = R.parseRulesForm({ tax_year: "2026" });
  assert.equal(r.ok, true);
  assert.equal(r.rules.mileage_rate_cents, null);
  assert.equal(r.rules.sales_tax, "unknown");
  assert.equal(R.needsConfirmation(r.rules).length, 5);
});
test("values are validated, never clamped", () => {
  assert.equal(R.parseRulesForm({ tax_year: "2026", set_aside_percent: "80" }).ok, false);
  assert.equal(R.parseRulesForm({ tax_year: "2026", mileage_rate_cents: "abc" }).ok, false);
  assert.equal(R.parseRulesForm({ tax_year: "1999" }).ok, false);
  assert.equal(R.parseRulesForm({ tax_year: "2026", set_aside_percent: "-5" }).ok, false);
});
test("confirmed requires a value", () => {
  assert.equal(R.parseRulesForm({ tax_year: "2026", mileage_rate_confirmed: "on" }).ok, false);
  assert.equal(R.parseRulesForm({ tax_year: "2026", sales_tax: "unknown", sales_tax_confirmed: "on" }).ok, false);
  const ok = R.parseRulesForm({ tax_year: "2026", set_aside_percent: "25", set_aside_confirmed: "on", sales_tax: "not_applicable", sales_tax_confirmed: "on" });
  assert.equal(ok.ok, true);
  assert.equal(ok.rules.set_aside_percent, 25);
  assert.equal(R.needsConfirmation(ok.rules).some((s) => /Tax set-aside/.test(s)), false);
});
test("1099-K and 1099-NEC are separate rules", () => {
  const r = R.parseRulesForm({ tax_year: "2026", threshold_1099k_dollars: "600", threshold_1099nec_dollars: "2000" }).rules;
  assert.equal(r.threshold_1099k_dollars, 600); assert.equal(r.threshold_1099nec_dollars, 2000);
});
test("csv guards formulas but keeps real numbers", () => {
  assert.equal(C.csvCell("=1+1"), "'=1+1");
  assert.equal(C.csvCell("@x"), "'@x");
  assert.equal(C.csvCell(-5), "-5");
  assert.equal(C.csvCell('a,"b"'), '"a,""b"""');
  assert.equal(C.toCsv(["a", "b"], [{ a: 1, b: "x" }]), "a,b\r\n1,x\r\n");
});
