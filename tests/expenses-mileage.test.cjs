const test = require("node:test"), assert = require("node:assert/strict");
const E = require("../.testbuild/expenses.js"), M = require("../.testbuild/mileage.js"), R = require("../.testbuild/receipts.js"), S = require("../.testbuild/schema.js");

test("expense form: fixed categories, positive amounts, clean vendor", () => {
  const f = (o) => E.parseExpenseForm({ spent_on: "2026-10-02", amount: "24.99", category: "supplies", vendor: "Office Depot", ...o });
  const ok = f({ receipt_on_file: "on" });
  assert.equal(ok.ok, true); assert.deepEqual([ok.value.amount_cents, ok.value.category, ok.value.vendor, ok.value.receipt_on_file], [2499, "supplies", "Office Depot", true]);
  assert.equal(f({ vendor: "" }).value.vendor, null);
  for (const bad of [{ amount: "0" }, { amount: "-5" }, { amount: "abc" }, { category: "square_fees" }, { category: "" }, { spent_on: "2026-02-30" },
    { vendor: "jane@example.com" }, { vendor: "Card 4111111111111111" }, { vendor: "x".repeat(61) }, { vendor: "<script>" }]) assert.equal(f(bad).ok, false, JSON.stringify(bad));
  assert.ok(!E.CATEGORIES.some((c) => /square|processing/i.test(c.id)), "Square fees are not an expense category (already on each payment)");
});
test("expense totals and profit labeling", () => {
  const list = [{ id: 1, spent_on: "2026-10-02", amount_cents: 2500 }, { id: 2, spent_on: "2026-10-30", amount_cents: 1000 }, { id: 3, spent_on: "2026-09-30", amount_cents: 999 }];
  assert.deepEqual(E.summarizeExpenses(list, { from: "2026-10-01", to: "2026-10-31" }), { total: 3500, count: 2 });
  assert.equal(E.estimateProfit(10000, { total: 3500, count: 2 }), 6500);
  assert.equal(E.estimateProfit(10000, { total: 0, count: 0 }), null, "no expenses entered: no profit figure");
  assert.equal(E.estimateProfit(1000, { total: 3500, count: 1 }), -2500, "a loss is shown as negative");
});
test("mileage form: tenths of a mile, fixed purposes, odometer pairs", () => {
  assert.equal(M.parseMilesTenths("12.5"), 125); assert.equal(M.parseMilesTenths("0.1"), 1); assert.equal(M.parseMilesTenths("1000"), 10000);
  for (const bad of ["0", "0.0", "12.55", "1001", "-3", "", "x"]) assert.equal(M.parseMilesTenths(bad), null, bad);
  const f = (o) => M.parseTripForm({ driven_on: "2026-10-03", miles: "18.4", purpose: "patient_visits", ...o });
  assert.equal(f({}).ok, true); assert.equal(f({ purpose: "vacation" }).ok, false);
  assert.deepEqual([f({ odometer_start: "1000", odometer_end: "1018" }).value.odometer_start, f({ odometer_start: "1000", odometer_end: "1018" }).value.odometer_end], [1000, 1018]);
  assert.equal(f({ odometer_start: "1000" }).ok, false, "both or neither"); assert.equal(f({ odometer_start: "1010", odometer_end: "1000" }).ok, false);
  assert.ok(!Object.keys(f({}).value).some((k) => /address|destination|from|to|location/i.test(k)), "no place fields");
});
test("mileage deduction uses each trip's own tax-year rate and flags missing or unconfirmed rates", () => {
  const trips = [{ id: 1, driven_on: "2026-12-31", miles_tenths: 100, purpose: "other", odometer_start: null, odometer_end: null }, { id: 2, driven_on: "2027-01-01", miles_tenths: 50, purpose: "other", odometer_start: null, odometer_end: null }];
  const all = { from: "2026-12-28", to: "2027-01-03" };
  let s = M.mileageSummary(trips, all, { 2026: { centsPerMile: 70, confirmed: true }, 2027: { centsPerMile: 72.5, confirmed: false } });
  assert.deepEqual([s.miles_tenths, s.deductionCents, s.ratesMissing, s.unconfirmed], [150, 700 + 363, false, true]); // 10 mi x 70c + 5 mi x 72.5c (362.5 rounds to 363)
  s = M.mileageSummary(trips, all, { 2026: { centsPerMile: 70, confirmed: true } });
  assert.deepEqual([s.deductionCents, s.ratesMissing], [700, true], "a year with no rate adds miles but no dollars");
  assert.equal(M.mileageSummary(trips, { from: "2027-01-01", to: "2027-01-01" }, {}).trips, 1);
});

// a minimal synthetic JPEG: SOI, optional extra segment, SOF0 (h x w), SOS, entropy bytes, EOI
const seg = (marker, body) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
const jpeg = ({ extra = [], w = 100, h = 80, end = true } = {}) => Uint8Array.from([0xff, 0xd8, ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), ...extra,
  ...seg(0xc0, [8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]), ...seg(0xda, [1, 1, 0, 0, 63, 0]), 1, 2, 3, ...(end ? [0xff, 0xd9] : [])]);
test("receipt photos: plain JPEG only, metadata and junk refused", () => {
  assert.deepEqual(R.inspectJpeg(jpeg()), { ok: true, width: 100, height: 80 });
  assert.equal(R.inspectJpeg(jpeg({ extra: seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0]) })).ok, false, "EXIF/XMP (location, camera)");
  assert.equal(R.inspectJpeg(jpeg({ extra: seg(0xed, [1, 2]) })).ok, false, "IPTC");
  assert.equal(R.inspectJpeg(jpeg({ extra: seg(0xfe, [104, 105]) })).ok, false, "comment text");
  assert.equal(R.inspectJpeg(jpeg({ end: false })).ok, false, "truncated");
  assert.equal(R.inspectJpeg(jpeg({ w: 7000 })).ok, false, "huge dimensions");
  assert.equal(R.inspectJpeg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])).ok, false, "PNG");
  assert.equal(R.inspectJpeg(Uint8Array.from(Buffer.from("<html><script>"))).ok, false);
  assert.equal(R.inspectJpeg(new Uint8Array(R.MAX_RECEIPT_BYTES + 1)).ok, false, "too big");
  assert.equal(R.inspectJpeg(new Uint8Array(0)).ok, false);
});
test("schema v3: additive, no place or person columns, receipts capped and JPEG only", () => {
  const sql = S.schemaStatements.join("\n");
  assert.equal(S.SCHEMA_VERSION, 3);
  for (const t of ["expenses", "expense_receipts", "mileage_trips"]) assert.ok(S.EXPORT_TABLES.includes(t), t);
  assert.doesNotMatch(sql, /\b(from_place|to_place|destination|address|location|latitude|longitude|gps)\b/i);
  assert.match(sql, /content_type = 'image\/jpeg'/); assert.match(sql, /octet_length\(data\) BETWEEN 1 AND 1500000/);
  assert.doesNotMatch(sql, /'(square_fees|processing_fees)'/, "no processor-fee expense category");
});
