const test = require("node:test"), assert = require("node:assert/strict");
const V = require("../.testbuild/inventory.js");
let id = 0;
const mv = (o) => ({ id: ++id, item_id: 1, moved_on: "2026-10-01", kind: "purchase", quantity: 1, unit_cost_cents: null, reason: null, lot_number: null, expires_on: null, ...o });

test("opening stock and purchases give a weighted average cost", () => {
  const r = V.replay([mv({ kind: "opening", quantity: 10, unit_cost_cents: 100 }), mv({ kind: "purchase", quantity: 10, unit_cost_cents: 200, moved_on: "2026-10-02" })]);
  assert.deepEqual([r.ok, r.onHand, r.valueCents, r.avgCostCents], [true, 20, 3000, 150]);
});
test("using stock removes it at the average cost; the last unit removes all remaining value (no drift)", () => {
  const base = [mv({ kind: "opening", quantity: 3, unit_cost_cents: 100 }), mv({ kind: "purchase", quantity: 4, unit_cost_cents: 101, moved_on: "2026-10-02" })];
  let r = V.replay([...base, mv({ kind: "use", quantity: 2, moved_on: "2026-10-03" })]);
  assert.equal(r.onHand, 5); assert.equal(r.valueCents, 704 - Math.round((704 * 2) / 7));
  r = V.replay([...base, mv({ kind: "use", quantity: 7, moved_on: "2026-10-03" })]);
  assert.deepEqual([r.onHand, r.valueCents, r.avgCostCents], [0, 0, 0]);
});
test("cannot use more than is on hand, even through a back-dated entry", () => {
  const h = [mv({ kind: "opening", quantity: 5, unit_cost_cents: 100 }), mv({ kind: "use", quantity: 4, moved_on: "2026-10-10" })];
  assert.match(V.checkAdd(h, { item_id: 1, moved_on: "2026-10-11", kind: "use", quantity: 2, unit_cost_cents: null, reason: null, lot_number: null, expires_on: null }), /Not enough on hand/);
  assert.match(V.checkAdd(h, { item_id: 1, moved_on: "2026-10-05", kind: "use", quantity: 2, unit_cost_cents: null, reason: null, lot_number: null, expires_on: null }), /Not enough on hand on 2026-10-10/, "would break the later use");
  assert.equal(V.checkAdd(h, { item_id: 1, moved_on: "2026-10-11", kind: "use", quantity: 1, unit_cost_cents: null, reason: null, lot_number: null, expires_on: null }), null);
});
test("adjustments: down removes at average, up adds at average (zero with nothing on hand)", () => {
  let r = V.replay([mv({ kind: "opening", quantity: 10, unit_cost_cents: 100 }), mv({ kind: "adjust_down", quantity: 2, reason: "expired", moved_on: "2026-10-02" }), mv({ kind: "adjust_up", quantity: 1, reason: "count_correction", moved_on: "2026-10-03" })]);
  assert.deepEqual([r.onHand, r.valueCents], [9, 900]);
  r = V.replay([mv({ kind: "adjust_up", quantity: 3, reason: "count_correction" })]);
  assert.deepEqual([r.onHand, r.valueCents], [3, 0]);
});
test("low stock uses each item's own level; no level = no alert", () => {
  assert.equal(V.isLowStock(5, 5), true); assert.equal(V.isLowStock(6, 5), false); assert.equal(V.isLowStock(0, null), false); assert.equal(V.isLowStock(0, 0), true);
});
test("movement form rules: cost on purchases, reason on adjustments, lot/expiry only on purchases", () => {
  const f = (o) => V.parseMovementForm({ item_id: "1", moved_on: "2026-10-01", kind: "purchase", quantity: "5", unit_cost: "2.50", ...o });
  const ok = f({ lot_number: "LOT-42/A", expires_on: "2027-03-31" });
  assert.equal(ok.ok, true); assert.deepEqual([ok.value.unit_cost_cents, ok.value.lot_number, ok.value.expires_on], [250, "LOT-42/A", "2027-03-31"]);
  assert.equal(f({ unit_cost: "" }).ok, false); assert.equal(f({ unit_cost: "0" }).ok, true, "free stock allowed");
  assert.equal(f({ kind: "use", unit_cost: undefined, lot_number: "X1" }).ok, false);
  assert.equal(f({ kind: "adjust_down", unit_cost: undefined }).ok, false, "needs a reason");
  assert.equal(f({ kind: "adjust_down", unit_cost: undefined, reason: "lost" }).ok, true);
  assert.equal(f({ quantity: "0" }).ok, false); assert.equal(f({ quantity: "1.5" }).ok, false); assert.equal(f({ lot_number: "Mary Smith" }).ok, false, "lot numbers can't hold sentences");
  assert.equal(f({ expires_on: "2027-02-30" }).ok, false);
});
test("item form: name, unit, optional reorder level", () => {
  assert.equal(V.parseItemForm({ label: "Gloves", unit: "box", reorder_level: "3" }).value.reorder_level, 3);
  assert.equal(V.parseItemForm({ label: "Gloves", unit: "box" }).value.category, "General");
  assert.equal(V.parseItemForm({ label: "", unit: "box" }).ok, false); assert.equal(V.parseItemForm({ label: "x", unit: "box", reorder_level: "-1" }).ok, false);
});
