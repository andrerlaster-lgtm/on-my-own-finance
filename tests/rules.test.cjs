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

test("the optional July 1 mileage rate is not 'missing' when empty, and needs confirming once set", () => {
  assert.equal(R.needsConfirmation(R.emptyRules(2025)).some((s) => /July 1/.test(s)), false);
  const set = R.parseRulesForm({ tax_year: "2026", mileage_rate_h2_cents: "76" }).rules;
  assert.equal(set.mileage_rate_h2_cents, 76);
  assert.ok(R.needsConfirmation(set).some((s) => /July 1.*set but not confirmed/.test(s)));
  assert.equal(R.parseRulesForm({ tax_year: "2026", mileage_rate_h2_confirmed: "on" }).ok, false, "confirmed needs a value");
});

test("the published 2026 figures are exactly the ones researched, and set-aside is never published", () => {
  const p = R.publishedFor(2026);
  assert.equal(p.mileage_rate_cents.value, 72.5);
  assert.equal(p.mileage_rate_h2_cents.value, 76);
  assert.equal(p.threshold_1099k_dollars.value, 20000);
  assert.equal(p.threshold_1099nec_dollars.value, 2000);
  assert.equal(p.set_aside_percent, undefined);
  for (const f of Object.values(p)) assert.ok(f.source && f.note, "every figure names its source and what it means");
  assert.equal(R.publishedFor(2025), null);
});

test("filling in published figures only touches empty fields and never confirms anything", () => {
  const empty = R.emptyRules(2026);
  const a = R.applyPublished(empty);
  assert.equal(a.filled.length, 4);
  assert.equal(a.rules.mileage_rate_cents, 72.5); assert.equal(a.rules.mileage_rate_h2_cents, 76);
  assert.equal(a.rules.threshold_1099k_dollars, 20000); assert.equal(a.rules.threshold_1099nec_dollars, 2000);
  assert.equal(a.rules.set_aside_percent, null);
  assert.ok(!a.rules.mileage_rate_confirmed && !a.rules.mileage_rate_h2_confirmed && !a.rules.threshold_1099k_confirmed && !a.rules.threshold_1099nec_confirmed);
  assert.ok(R.needsConfirmation(a.rules).some((s) => /Mileage rate.*set but not confirmed/.test(s)));
  // existing values (and their confirmations) are kept
  const mine = { ...empty, mileage_rate_cents: 70, mileage_rate_confirmed: true, threshold_1099nec_dollars: 600 };
  const b = R.applyPublished(mine);
  assert.equal(b.rules.mileage_rate_cents, 70); assert.equal(b.rules.mileage_rate_confirmed, true); assert.equal(b.rules.threshold_1099nec_dollars, 600);
  assert.equal(b.filled.length, 2);
  // running it again changes nothing; other years are untouched
  assert.deepEqual(R.applyPublished(a.rules).filled, []);
  const y25 = R.emptyRules(2025);
  assert.deepEqual(R.applyPublished(y25), { rules: y25, filled: [] });
});
