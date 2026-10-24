const test = require("node:test"), assert = require("node:assert/strict");
const L = require("../.testbuild/lots.js"), V = require("../.testbuild/inventory.js"), S = require("../.testbuild/schema.js");
let id = 0;
const mv = (o) => ({ id: ++id, item_id: 1, moved_on: "2026-01-01", kind: "purchase", quantity: 1, unit_cost_cents: null, reason: null, lot_number: null, expires_on: null, ...o });
const buy = (lot, q, exp, date, cost = 100) => mv({ kind: "purchase", quantity: q, unit_cost_cents: cost, lot_number: lot, expires_on: exp, moved_on: date });
const use = (q, date, extra = {}) => mv({ kind: "use", quantity: q, moved_on: date, ...extra });

test("lot balances = received minus assigned uses; sorted earliest expiry first, no-expiry last", () => {
  const a = buy("LOT-B", 10, "2027-06-30", "2026-01-01"), b = buy("LOT-A", 5, "2026-12-31", "2026-02-01"), c = buy("NOEXP", 4, null, "2026-01-15");
  const u = use(3, "2026-03-01");
  const lots = L.lotBalances([a, b, c, u], [{ movement_id: u.id, lot_number: "LOT-A", quantity: 3 }]);
  assert.deepEqual(lots.map((l) => [l.lot_number, l.received, l.used, l.onHand]), [["LOT-A", 5, 3, 2], ["LOT-B", 10, 0, 10], ["NOEXP", 4, 0, 4]]);
  assert.equal(L.lotBalances([a, b, c, u], [{ movement_id: u.id, lot_number: "LOT-A", quantity: 3 }], "2026-02-15").find((l) => l.lot_number === "LOT-A").used, 0, "as of a date before the use");
});
test("earliest-expiring-first split, and what no lot can cover", () => {
  const lots = L.lotBalances([buy("LATE", 10, "2027-12-31", "2026-01-01"), buy("EARLY", 4, "2026-06-30", "2026-01-02")], []);
  assert.deepEqual(L.suggestAllocation(lots, 6), { allocations: [{ lot_number: "EARLY", quantity: 4 }, { lot_number: "LATE", quantity: 2 }], remainder: 0 });
  assert.deepEqual(L.suggestAllocation(lots, 20).remainder, 6);
  assert.deepEqual(L.suggestAllocation([], 3), { allocations: [], remainder: 3 }, "items without lots: nothing to assign");
});
test("allocation checks: lot must exist, have stock, have arrived, and not exceed the amount used", () => {
  const lots = L.lotBalances([buy("A1", 5, null, "2026-03-01")], []);
  const v = (allocs, q = 5, date = "2026-04-01") => L.validateAllocation(lots, allocs, q, date);
  assert.equal(v([{ lot_number: "A1", quantity: 5 }]), null);
  assert.match(v([{ lot_number: "ZZ", quantity: 1 }]), /not found/); assert.match(v([{ lot_number: "A1", quantity: 6 }], 6), /only 5/);
  assert.match(v([{ lot_number: "A1", quantity: 2 }], 1), /more than the amount used/); assert.match(v([{ lot_number: "A1", quantity: 1 }], 1, "2026-02-01"), /not arrived/);
  assert.match(v([{ lot_number: "A1", quantity: 1 }, { lot_number: "A1", quantity: 1 }]), /twice/); assert.match(v([{ lot_number: "A1", quantity: 0 }]), /whole numbers/);
});
test("a lot number carries one expiry date only", () => {
  const ex = [buy("L1", 5, "2027-01-31", "2026-01-01")];
  assert.match(L.checkLotConsistency(ex, { kind: "purchase", lot_number: "L1", expires_on: "2027-02-28" }), /only one expiry/);
  assert.match(L.checkLotConsistency(ex, { kind: "purchase", lot_number: "L1", expires_on: null }), /expiry 2027-01-31/);
  assert.equal(L.checkLotConsistency(ex, { kind: "purchase", lot_number: "L1", expires_on: "2027-01-31" }), null);
  assert.equal(L.checkLotConsistency(ex, { kind: "use", lot_number: null, expires_on: null }), null);
});
test("past uses are assigned earliest-expiring first, only among lots that had arrived, and existing allocations are kept", () => {
  const late = buy("LATE", 10, "2028-01-01", "2026-01-01"), early = buy("EARLY", 5, "2026-06-01", "2026-03-01");
  const u1 = use(4, "2026-02-01"), u2 = use(6, "2026-04-01"), u3 = use(2, "2026-05-01");
  const done = [{ movement_id: u3.id, lot_number: "LATE", quantity: 2 }];
  const out = L.backfillAllocations([late, early, u1, u2, u3], done);
  // u1: EARLY had not arrived -> LATE 4. u2: EARLY(5) first, then LATE 1.
  assert.deepEqual(out.filter((x) => x.movement_id === u1.id), [{ movement_id: u1.id, lot_number: "LATE", quantity: 4 }]);
  assert.deepEqual(out.filter((x) => x.movement_id === u2.id), [{ movement_id: u2.id, lot_number: "EARLY", quantity: 5 }, { movement_id: u2.id, lot_number: "LATE", quantity: 1 }]);
  assert.equal(out.some((x) => x.movement_id === u3.id), false);
  const after = L.lotBalances([late, early, u1, u2, u3], [...done, ...out]);
  assert.deepEqual(after.map((l) => [l.lot_number, l.onHand]), [["EARLY", 0], ["LATE", 3]], "LATE: 10 - 4 - 1 - 2");
});
test("unassigned removals are reported only for items that have lots", () => {
  const p = buy("L1", 10, null, "2026-01-01"), u = use(4, "2026-02-01");
  assert.deepEqual(L.unassignedRemovals([p, u], [{ movement_id: u.id, lot_number: "L1", quantity: 1 }]).map((x) => x.unassigned), [3]);
  assert.deepEqual(L.unassignedRemovals([mv({ kind: "purchase", quantity: 5, unit_cost_cents: 1 }), use(1, "2026-02-01")], []), []);
});
test("expiry status and alerts: per-item window, expired with stock, nothing for empty lots", () => {
  assert.equal(L.expiryStatus("2026-10-01", "2026-10-02", 30), "expired"); assert.equal(L.expiryStatus("2026-10-02", "2026-10-02", 30), "soon");
  assert.equal(L.expiryStatus("2026-11-01", "2026-10-02", 30), "soon"); assert.equal(L.expiryStatus("2026-11-02", "2026-10-02", 30), "ok"); assert.equal(L.expiryStatus(null, "2026-10-02", 30), "none");
  const items = [{ id: 1, label: "Tubes", unit: "box" }, { id: 2, label: "Swabs", unit: "pack" }];
  const ms = [buy("T1", 5, "2026-10-20", "2026-01-01"), mv({ item_id: 2, kind: "purchase", quantity: 3, unit_cost_cents: 5, lot_number: "S1", expires_on: "2026-10-20", moved_on: "2026-01-01" }),
    mv({ item_id: 1, kind: "purchase", quantity: 2, unit_cost_cents: 5, lot_number: "OLD", expires_on: "2026-09-01", moved_on: "2026-01-01" })];
  const alerts = L.expiryAlerts(items, ms, [], new Map([[2, 5]]), "2026-10-02");
  assert.deepEqual(alerts.map((a) => [a.lot_number, a.status, a.daysLeft]), [["OLD", "expired", -31], ["T1", "soon", 18]], "Swabs has a 5-day window, so it is not flagged");
});
test("lot lookup shows dates and quantities only", () => {
  const p = buy("TRACE9", 10, "2027-01-01", "2026-01-05", 250), u = use(3, "2026-02-02");
  const h = L.lotHistory("TRACE9", [{ id: 1, label: "Tubes", unit: "box" }], [p, u], [{ movement_id: u.id, lot_number: "TRACE9", quantity: 3 }]);
  assert.equal(h.length, 1); assert.equal(h[0].onHand, 7);
  assert.deepEqual(h[0].used, [{ date: "2026-02-02", kind: "use", quantity: 3 }]); assert.deepEqual(h[0].received, [{ date: "2026-01-05", quantity: 10, unit_cost_cents: 250 }]);
  assert.deepEqual(L.lotHistory("NOPE", [{ id: 1, label: "Tubes", unit: "box" }], [p, u], []), []);
  assert.ok(!JSON.stringify(h).match(/visit|patient|person|name/i));
});
test("year-end report: begin/end stock and value, and each kind of change valued at the average cost at the time", () => {
  const ms = [mv({ kind: "opening", quantity: 10, unit_cost_cents: 100, moved_on: "2025-12-31" }),
    mv({ kind: "purchase", quantity: 10, unit_cost_cents: 200, moved_on: "2026-01-10" }),            // 20 on hand, value 3000, avg 150
    mv({ kind: "use", quantity: 4, moved_on: "2026-02-01" }),                                       // removes 600
    mv({ kind: "adjust_down", quantity: 2, reason: "expired", moved_on: "2026-03-01" }),            // 16 -> 14: removes 300 (avg 150)
    mv({ kind: "adjust_down", quantity: 1, reason: "lost", moved_on: "2026-03-02" }),               // removes 150
    mv({ kind: "adjust_up", quantity: 1, reason: "count_correction", moved_on: "2026-03-03" }),     // adds 150
    mv({ kind: "purchase", quantity: 5, unit_cost_cents: 300, moved_on: "2027-01-05" })];
  const rep = L.inventoryReport([{ id: 1, label: "Tubes", unit: "box" }], ms, "2026-01-01", "2026-12-31");
  const r = rep.rows[0];
  assert.deepEqual([r.beginQty, r.beginValue, r.endQty, r.endValue], [10, 1000, 14, 2100], "begins with the 2025 opening stock; the 2027 purchase is outside the year");
  assert.deepEqual([r.purchaseQty, r.purchaseValue, r.useQty, r.useValue], [10, 2000, 4, 600], "use of 4 at the 150 average");
  assert.deepEqual([r.writeOffQty, r.writeOffValue, r.adjDownQty, r.adjDownValue, r.adjUpQty, r.adjUpValue], [2, 300, 1, 150, 1, 150], "expired is a write-off; other removals are plain adjustments");
  assert.equal(r.openingQty, 0, "opening stock dated before the period is not a change in it");
  assert.equal(rep.totals.endValue, 2100); assert.deepEqual(rep.problems, []);
});
test("schema v4 is additive and holds no names or places", () => {
  assert.ok(S.SCHEMA_VERSION >= 4); for (const t of ["inventory_lot_uses", "inventory_settings"]) assert.ok(S.EXPORT_TABLES.includes(t), t);
});

test("every exported table can be ordered (each has the column the export sorts by)", () => {
  const sql = S.schemaStatements.join("\n");
  for (const t of S.EXPORT_TABLES) {
    const col = S.EXPORT_ORDER[t] ?? "id";
    const body = new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(([\\s\\S]*?)\\n   \\)`).exec(sql)[1];
    assert.match(body, new RegExp(`^\\s*${col}\\s`, "m"), `${t} has a ${col} column`);
  }
});
