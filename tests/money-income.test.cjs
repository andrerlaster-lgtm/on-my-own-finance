const test = require("node:test"), assert = require("node:assert/strict");
const M = require("../.testbuild/money.js"), D = require("../.testbuild/dates.js"), I = require("../.testbuild/income.js");

test("money parses strictly to cents", () => {
  assert.equal(M.parseCents("12"), 1200); assert.equal(M.parseCents("12.5"), 1250); assert.equal(M.parseCents("$0.07"), 7);
  for (const bad of ["", "-1", "1.234", "1,000", "abc", "1e3", "1000000000"]) assert.equal(M.parseCents(bad), null, bad);
  assert.equal(M.formatCents(123456), "$1,234.56"); assert.equal(M.formatCents(-5), "-$0.05");
});
test("dates and periods (week is Monday to Sunday)", () => {
  assert.equal(D.parseDate("2026-02-29"), null); assert.equal(D.parseDate("2026-02-28"), "2026-02-28"); assert.equal(D.parseDate("26-1-1"), null);
  const p = D.periodRanges("2026-10-23"); // a Friday
  assert.deepEqual(p.week, { from: "2026-10-19", to: "2026-10-25" });
  assert.deepEqual(p.month, { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(p.year, { from: "2026-01-01", to: "2026-12-31" });
  assert.deepEqual(D.periodRanges("2026-02-10").month, { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(D.periodRanges("2027-01-01").week, { from: "2026-12-28", to: "2027-01-03" });
  assert.match(D.todayInChicago(new Date("2026-10-23T03:00:00Z")), /^2026-10-22$/, "still the 22nd in Texas");
});
test("income form: validation", () => {
  const ok = I.parseIncomeForm({ occurred_on: "2026-10-01", source: "check", tax_form: "unknown", gross: "150", tip: "20", fee: "0", visits: "2" });
  assert.equal(ok.ok, true); assert.deepEqual([ok.value.gross_cents, ok.value.tip_cents, ok.value.visits], [15000, 2000, 2]);
  const bad = (o) => I.parseIncomeForm({ occurred_on: "2026-10-01", source: "check", gross: "100", ...o }).ok;
  assert.equal(bad({ source: "square" }), false, "Square rows only come from the import");
  assert.equal(bad({ gross: "" }), false, "needs revenue or tips");
  assert.equal(bad({ fee: "200" }), false, "fee larger than receipts");
  assert.equal(bad({ gross: "-1" }), false); assert.equal(bad({ visits: "2000" }), false); assert.equal(bad({ tax_form: "1099x" }), false);
});
test("source and tax form are independent", () => {
  const r = I.parseIncomeForm({ occurred_on: "2026-10-01", source: "bank_transfer", tax_form: "1099nec", gross: "100" });
  assert.equal(r.value.source, "bank_transfer"); assert.equal(r.value.tax_form, "1099nec");
  assert.equal(I.parseIncomeForm({ occurred_on: "2026-10-01", source: "cash", gross: "100" }).value.tax_form, "unknown", "no form is assumed");
});
test("summaries count every cent once; tips are separate; net is receipts minus fees", () => {
  const e = (o) => ({ id: 1, occurred_on: "2026-10-20", source: "square", tax_form: "unknown", gross_cents: 0, tip_cents: 0, fee_cents: 0, visits: 0, imported: true, ...o });
  const entries = [
    e({ gross_cents: 10000, tip_cents: 1500, fee_cents: 350, visits: 1, tax_form: "1099k" }),
    e({ gross_cents: 5000, fee_cents: 160, visits: 1, tax_form: "1099k", occurred_on: "2026-10-25" }),
    e({ gross_cents: 20000, visits: 3, tax_form: "1099nec", source: "check", occurred_on: "2026-10-05" }),
    e({ gross_cents: 999, occurred_on: "2026-09-30" }),
  ];
  const w = I.summarize(entries, { from: "2026-10-19", to: "2026-10-25" });
  assert.deepEqual([w.visits, w.revenue, w.tips, w.receipts, w.fees, w.netAfterFees], [2, 15000, 1500, 16500, 510, 15990]);
  assert.deepEqual(w.byTaxForm["1099k"], { receipts: 16500, fees: 510 }); assert.deepEqual(w.byTaxForm["1099nec"], { receipts: 0, fees: 0 });
  const m = I.summarize(entries, { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(m.receipts, 36500); assert.equal(m.byTaxForm["1099nec"].receipts, 20000);
  assert.equal(Object.values(m.byTaxForm).reduce((s, x) => s + x.receipts, 0), m.receipts, "form buckets add up to the total");
});
