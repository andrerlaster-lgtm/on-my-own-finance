const test = require("node:test"), assert = require("node:assert/strict");
const M = require("../.testbuild/mileage.js"), RT = require("../.testbuild/routing.js"), MR = require("../.testbuild/mileageReports.js"), R = require("../.testbuild/reports.js"), S = require("../.testbuild/statements.js"), X = require("../.testbuild/xlsx.js"), P = require("../.testbuild/pdfdoc.js");

// Synthetic trips only.
const form = (o = {}) => ({ driven_on: "2026-10-05", start_label: "Abilene, TX", end_label: "Dallas, TX", purpose: "patient_visits", trip_type: "one_way", category: "business", ...o });
const trip = (id, on, tenths, o = {}) => ({ id, driven_on: on, miles_tenths: tenths, purpose: "patient_visits", odometer_start: null, odometer_end: null, start_label: "Abilene, TX", end_label: "Dallas, TX", trip_type: "one_way", category: "business", miles_status: "actual", distance_source: "manual", one_way_est_tenths: null, remarks: null, ...o });
const rates = { 2025: { centsPerMile: 70, confirmed: true }, 2026: { centsPerMile: 72.5, confirmed: true } };

test("one-way estimate counts the estimate once and stays labelled estimated", () => {
  const r = M.parseTripEntry(form({ estimate_tenths: "1802", estimate_source: "route_city" }));
  assert.ok(r.ok); assert.equal(r.value.miles_tenths, 1802); assert.equal(r.value.miles_status, "estimated"); assert.equal(r.value.distance_source, "route_city"); assert.equal(r.value.one_way_est_tenths, 1802);
});
test("round trip doubles the one-way estimate", () => {
  const r = M.parseTripEntry(form({ trip_type: "round_trip", estimate_tenths: "1802", estimate_source: "route_address" }));
  assert.equal(r.value.miles_tenths, 3604); assert.equal(r.value.miles_status, "estimated"); assert.equal(r.value.distance_source, "route_address");
});
test("actual miles replace the estimate, are a total, and make the trip actual", () => {
  const r = M.parseTripEntry(form({ trip_type: "round_trip", estimate_tenths: "1802", estimate_source: "route_city", actual_miles: "375.5" }));
  assert.equal(r.value.miles_tenths, 3755); assert.equal(r.value.miles_status, "actual"); assert.equal(r.value.distance_source, "manual"); assert.equal(r.value.one_way_est_tenths, 1802, "the estimate is kept for the record");
});
test("typed miles alone, and odometer alone, work without any routing service", () => {
  assert.equal(M.parseTripEntry(form({ actual_miles: "12" })).value.miles_tenths, 120);
  const o = M.parseTripEntry(form({ odometer_start: "1000", odometer_end: "1012" }));
  assert.equal(o.value.miles_tenths, 120); assert.equal(o.value.distance_source, "odometer"); assert.equal(o.value.miles_status, "actual");
});
test("the trip form rejects bad input", () => {
  const bad = (o) => { const r = M.parseTripEntry(form(o)); assert.equal(r.ok, false); return r.errors.join(" | "); };
  assert.match(bad({}), /calculate an estimate/);
  assert.match(bad({ start_label: "123 Main St", actual_miles: "5" }), /Starting location/);
  assert.match(bad({ end_label: "Dallas, TX 75201", actual_miles: "5" }), /Destination/);
  assert.match(bad({ actual_miles: "0" }), /Actual miles/);
  assert.match(bad({ actual_miles: "5", purpose: "x" }), /purpose/);
  assert.match(bad({ estimate_tenths: "999999" }), /Estimated miles/);
  assert.match(bad({ estimate_tenths: "9000", trip_type: "round_trip" }), /more than 1,000/);
  assert.match(bad({ actual_miles: "5", remarks: "call 5125551234" }), /Notes/);
  assert.match(bad({ actual_miles: "5", odometer_start: "10", odometer_end: "5" }), /Odometer/);
  assert.equal(M.cleanCity("san  angelo ,tx"), "san angelo, TX");
  assert.equal(M.cleanCity("Abilene,tx"), "Abilene, TX"); assert.equal(M.cleanCity("Dallas"), "Dallas"); assert.equal(M.cleanCity("12 Elm St"), null); assert.equal(M.cleanCity("a@b.com"), null);
  assert.equal(M.cleanStreet(""), ""); assert.equal(M.cleanStreet("100 Main St"), "100 Main St"); assert.equal(M.cleanStreet("x".repeat(81)), null); assert.equal(M.cleanStreet("a@b"), null);
});
test("categories: only business counts; personal and commuting are kept and excluded", () => {
  assert.equal(M.parseTripEntry(form({ actual_miles: "5", category: "commuting" })).value.category, "commuting");
  assert.equal(M.parseTripEntry(form({ actual_miles: "5", category: "weird" })).value.category, "business");
  const trips = [trip(1, "2026-10-01", 1000), trip(2, "2026-10-02", 500, { category: "personal" }), trip(3, "2026-10-03", 300, { category: "commuting" }), trip(4, "2026-10-04", 200, { miles_status: "estimated" }), { id: 5, driven_on: "2026-10-05", miles_tenths: 100, purpose: "other", odometer_start: null, odometer_end: null }];
  const s = M.mileageSummary(trips, { from: "2026-10-01", to: "2026-10-31" }, rates);
  assert.equal(s.miles_tenths, 1300, "old rows without a category count as business"); assert.equal(s.trips, 3); assert.equal(s.excluded_tenths, 800); assert.equal(s.estimated_tenths, 200);
  assert.equal(s.deductionCents, Math.round((1300 * 72.5) / 10));
});
test("the deduction uses the rate of each trip's own tax year and never invents one", () => {
  const trips = [trip(1, "2025-06-01", 1000), trip(2, "2026-06-01", 1000), trip(3, "2027-01-01", 1000)];
  const s = M.mileageSummary(trips, { from: "2025-01-01", to: "2027-12-31" }, rates);
  assert.equal(s.deductionCents, 7000 + 7250); assert.ok(s.ratesMissing);
});
test("duplicates are found by date, cities, direction and miles", () => {
  const e = M.parseTripEntry(form({ actual_miles: "100" })).value;
  assert.ok(M.findDuplicate([trip(1, "2026-10-05", 1000)], e));
  assert.equal(M.findDuplicate([trip(1, "2026-10-05", 1000)], e, 1), null, "editing a trip is not a duplicate of itself");
  assert.equal(M.findDuplicate([trip(1, "2026-10-05", 1001)], e), null);
  assert.equal(M.findDuplicate([trip(1, "2026-10-05", 1000, { trip_type: "round_trip" })], e), null);
});

/* ---------- routing service (fake fetch only) ---------- */
const reply = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const geo = (lon, lat) => ({ features: [{ geometry: { coordinates: [lon, lat] }, properties: { label: "x" } }] });
const fakeFetch = (routes = {}) => { const calls = []; const f = (url, init) => { calls.push({ url, init }); if (url.includes("/geocode/")) return routes.geo ? routes.geo(url) : reply(200, geo(-99.7, 32.4)); return routes.dir ? routes.dir(init) : reply(200, { routes: [{ summary: { distance: 290000 } }] }); }; f.calls = calls; return f; };

test("distance in meters becomes tenths of a mile, never zero", () => {
  assert.equal(RT.metersToTenths(1609.344), 10); assert.equal(RT.metersToTenths(290000), 1802); assert.equal(RT.metersToTenths(1), 1);
});
test("city to city: geocodes both, asks for a driving route, sends the key only in a header", async () => {
  const f = fakeFetch();
  const r = await RT.estimateDrivingMiles({ from: "Abilene, TX", to: "Dallas, TX" }, "SECRET-KEY", f);
  assert.ok(r.ok); assert.equal(r.oneWayTenths, 1802); assert.equal(r.source, "route_city");
  assert.equal(f.calls.length, 3); assert.match(f.calls[2].url, /driving-car/); assert.equal(f.calls[2].init.method, "POST");
  for (const c of f.calls) { assert.equal(c.init.headers.Authorization, "SECRET-KEY"); assert.ok(!c.url.includes("SECRET-KEY"), "key is never in a URL"); }
});
test("street addresses switch the source label", async () => {
  const f = fakeFetch(); const r = await RT.estimateDrivingMiles({ from: "Abilene, TX", to: "Dallas, TX", toStreet: "100 Main St" }, "k", f);
  assert.equal(r.source, "route_address"); assert.ok(decodeURIComponent(f.calls[1].url.replace(/\+/g, " ")).includes("100 Main St, Dallas, TX"));
});
test("failures are graceful and never expose the key", async () => {
  const msgs = async (routes, key = "SECRET-KEY") => { const r = await RT.estimateDrivingMiles({ from: "A", to: "B" }, key, fakeFetch(routes)); assert.equal(r.ok, false); assert.ok(!JSON.stringify(r).includes("SECRET-KEY")); return r.reason; };
  assert.equal(await msgs({}, ""), "no_key"); assert.equal((await RT.estimateDrivingMiles({ from: "A", to: "B" }, undefined, fakeFetch())).reason, "no_key");
  assert.equal(await msgs({ geo: () => reply(200, { features: [] }) }), "not_found");
  assert.equal(await msgs({ geo: () => reply(429, {}) }), "limit");
  assert.equal(await msgs({ geo: () => reply(401, {}) }), "no_key");
  assert.equal(await msgs({ geo: () => reply(500, {}) }), "unavailable");
  assert.equal(await msgs({ dir: () => reply(404, {}) }), "no_route");
  assert.equal(await msgs({ dir: () => reply(400, { error: { code: 2010 } }) }), "no_route");
  assert.equal(await msgs({ dir: () => reply(429, {}) }), "limit");
  assert.equal(await msgs({ dir: () => reply(200, { routes: [] }) }), "no_route");
  assert.equal(await msgs({ dir: () => reply(200, { routes: [{ summary: { distance: 0 } }] }) }), "no_route");
  assert.equal(await msgs({ geo: () => { throw new Error("network down with SECRET-KEY in it"); } }), "unavailable");
  for (const m of Object.values(RT.MESSAGES)) assert.match(m, /miles|usage limit|key/i);
});
test("a city that is not found with the city filter is retried without it", async () => {
  let n = 0; const f = fakeFetch({ geo: (url) => (url.includes("layers") && n++ === 0 ? reply(200, { features: [] }) : reply(200, geo(-99, 32))) });
  assert.ok((await RT.estimateDrivingMiles({ from: "Tiny", to: "Town" }, "k", f)).ok);
});

/* ---------- reports ---------- */
const period = (o) => S.resolvePeriod(o, "2026-10-15");
const sample = [trip(1, "2026-09-10", 1000), trip(2, "2026-10-02", 2000, { miles_status: "estimated", distance_source: "route_city", trip_type: "round_trip" }), trip(3, "2026-10-20", 1500), trip(4, "2026-10-21", 400, { category: "commuting" }), trip(5, "2026-10-22", 250, { category: "personal" })];
const cell = (doc, label, col) => doc.rows.find((r) => r.cells[0] && r.cells[0].text.trim() === label).cells[col];

test("mileage summary: totals, comparison, estimated share, excluded miles, deduction", () => {
  const d = MR.mileageSummaryDoc(sample, rates, period({ period: "month", y: "2026", m: "10" }));
  assert.equal(cell(d, "Number of business trips", 1).text, "2"); assert.equal(cell(d, "Number of business trips", 2).text, "1");
  assert.equal(cell(d, "Total business miles", 1).miles, 3500); assert.equal(cell(d, "Total business miles", 2).miles, 1000);
  assert.equal(cell(d, "Total business miles", 3).miles, 2500); assert.equal(Math.round(cell(d, "Total business miles", 4).percent), 250);
  assert.equal(cell(d, "of which estimated (not confirmed as actual)", 1).miles, 2000);
  assert.equal(cell(d, "Estimated mileage deduction", 1).amount, Math.round((3500 * 72.5) / 10));
  assert.equal(cell(d, "Personal and commuting miles (excluded)", 1).miles, 650);
  assert.match(d.notes.join(" "), /never deductible/); assert.match(d.notes.join(" "), /charged to customers/); assert.match(d.basis, /not posted to the ledger/);
});
test("monthly mileage comparison covers 12 months and ties to the summary", () => {
  const d = MR.mileageMonthlyDoc(sample, rates, 2026);
  assert.equal(d.rows.length, 13); const oct = d.rows[9], sep = d.rows[8];
  assert.equal(oct.cells[2].miles, 3500); assert.equal(oct.cells[4].miles, 2500); assert.equal(sep.cells[2].miles, 1000);
  const total = d.rows.at(-1); assert.equal(total.cells[2].miles, 4500); assert.equal(total.cells[1].text, "3");
  assert.equal(total.cells[3].amount, d.rows.reduce((t, r) => t + (r.kind === "line" && r.cells[3].amount ? r.cells[3].amount : 0), 0));
  const noRate = MR.mileageMonthlyDoc(sample, {}, 2026); assert.equal(noRate.rows.at(-1).cells[3].text, "rate not set");
  assert.ok(oct.cells[0].href.includes("mileage-log"));
});
test("mileage log lists business trips, then the excluded ones, with status", () => {
  const d = MR.mileageLogDoc(sample, { from: "2026-10-01", to: "2026-10-31" });
  const total = d.rows.find((r) => r.cells[0]?.text === "Total business miles"); assert.equal(total.cells[3].miles, 3500);
  assert.equal(d.rows.find((r) => r.cells[0]?.text === "Total excluded miles").cells[3].miles, 650);
  const text = JSON.stringify(d.rows); assert.match(text, /Estimated, route/); assert.match(text, /Actual, typed/); assert.match(text, /Round trip/); assert.match(text, /Commuting/);
  assert.ok(!text.includes("2026-09-10"));
});
test("mileage reports are available in Financial Reports, are never posted to the ledger, and the ledger is untouched", () => {
  for (const id of ["mileage-summary", "mileage-monthly", "mileage-log"]) assert.ok(R.REPORTS.some((r) => r.id === id) && R.MILEAGE_REPORT_IDS.includes(id));
  const none = R.buildReport("mileage-log", { entries: [], lines: [], problems: [] }, [], { period: "month", y: "2026", m: "10" }, "2026-10-15");
  assert.ok(none.blocked, "without the mileage log nothing is invented");
  const ledgerSrc = require("node:fs").readFileSync("src/lib/ledger.ts", "utf8");
  assert.ok(!/mileage_trips|listTrips|\.trips\b/.test(ledgerSrc), "the ledger never reads the mileage log, so a deduction cannot be posted or counted twice");
});
test("mileage reports export to Excel (real numbers) and PDF", () => {
  const d = R.buildReport("mileage-monthly", { entries: [], lines: [], problems: [] }, [], { period: "year", y: "2026" }, "2026-10-15", { trips: sample, rates });
  const zip = Buffer.from(X.reportToXlsx(d)).toString("latin1"); assert.ok(zip.includes("<v>350.0</v>"), "October business miles as a number");
  const pdf = Buffer.from(P.reportToPdf(d, "2026-10-15")).toString("latin1"); assert.ok(pdf.startsWith("%PDF-1.4") && pdf.includes("350.0"));
});
test("the tax packet leaves personal and commuting trips out", () => {
  const src = require("node:fs").readFileSync("src/lib/packet.ts", "utf8");
  assert.match(src, /startsWith\(y\) && isBusiness\(t\)/);
});
test("schema keeps the routing key and places out of the database", () => {
  const S2 = require("../.testbuild/schema.js"), sql = S2.schemaStatements.join("\n");
  assert.doesNotMatch(sql, /api_key|ors_/i); assert.ok(!S2.EXPORT_TABLES.includes("mileage_pending"));
});
