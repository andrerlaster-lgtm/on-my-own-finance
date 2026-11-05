const test = require("node:test"), assert = require("node:assert/strict");
const M = require("../.testbuild/masterImport.js"), Sch = require("../.testbuild/schema.js");

// Synthetic data only: made-up items, amounts, ids and places.
const sheet = (name, rows) => ({ name, rows });
const at = (sheets) => sheets.map((s, index) => ({ index, sheet: s }));

test("each sheet is sorted by its column names", () => {
  const kinds = [
    [["Date", "Tax", "Tip", "Total Collected", "Fees", "Net Total", "Payment ID", "Transaction Status"]],
    [["Date", "Category", "Item", "Qty", "Gross Sales", "Transaction ID", "Payment ID", "Customer Name"]],
    [["Sales summary - Summary\nAll day", ""], ["Gross sales", "$1.00"]],
    [["Date", "Category", "Description", "Amount ($)"]],
    [["Date", "Item", "Quantity", "Unit cost", "Lot", "Expiration"]],
    [["Date", "From", "To", "Miles", "Purpose"]],
    [["Date", "Odometer start", "Odometer end"]],
    [["Date", "Amount received", "Tip", "Payment method", "Paid by"]],
    [["Hello", "World"]],
  ].map((rows) => M.detectKind(sheet("s", rows)));
  assert.deepEqual(kinds, ["square", "square_items", "square_summary", "expenses", "inventory", "mileage", "mileage", "income", null]);
});

test("inventory: purchases with unit or total cost, lots and expiry; items grouped by name; bad rows skipped", () => {
  const s = sheet("Supplies", [
    ["Date", "Item", "Qty", "Total cost", "Unit", "Lot #", "Exp date", "Notes"],
    ["2026-01-05", "Red top tubes", "3", "$10.00", "box", "L-100", "2027-01-31", "SENTINEL_NOTE"],
    ["1/6/2026", "red top tubes", "2", "$8.00", "", "", "", ""],
    ["", "Gloves", "1", "", "", "", "", ""],
    ["2026-01-07", "Gauze", "1.5", "$2", "", "", "", ""],
    ["2026-01-07", "Bandages", "4", "$1", "", "bad lot!", "", ""],
    ["", "", "", "", "", "", "", ""],
  ]);
  const r = M.parseInventory(at([s]));
  assert.deepEqual(r.items.map((i) => [i.label, i.unit, i.count, i.quantity]), [["Red top tubes", "box", 2, 5], ["Gloves", "each", 1, 1]]);
  assert.deepEqual(r.rows.map((x) => [x.moved_on, x.quantity, x.unit_cost_cents, x.lot_number, x.expires_on]), [["2026-01-05", 3, 333, "L-100", "2027-01-31"], ["2026-01-06", 2, 400, null, null], [null, 1, null, null, null]]);
  assert.equal(r.rounded, 1, "$10.00 / 3 is rounded to the cent");
  assert.deepEqual(r.flags.map((f) => f.reason), ["quantity is not a whole number from 1 to 1,000,000", "lot number has characters other than letters, numbers and . _ / -"]);
  assert.deepEqual([r.sheets[0].undated, r.sheets[0].uncosted], [1, 1]);
  const raw = M.serializeInventory(r);
  assert.doesNotMatch(raw, /SENTINEL/);
  const back = M.parseInventoryPayload(raw);
  assert.deepEqual(back.rows, r.rows);
  const j = JSON.parse(raw); j.rows[0][4] = 0;
  assert.equal(M.parseInventoryPayload(JSON.stringify(j)), null, "a tampered quantity is refused");
  assert.equal(M.parseInventory(at([s])).rows[0].key, r.rows[0].key, "keys are stable, so a second import adds nothing");
});

test("an on-hand count sheet defaults to opening stock", () => {
  const r = M.parseInventory(at([sheet("Opening count", [["Item", "On hand"], ["Tubes", "10"]])]));
  assert.equal(r.sheets[0].opening, true);
  assert.equal(r.rows.length, 1);
});

test("mileage: miles or odometer, rounded to a tenth, purposes guessed, addresses never kept", () => {
  const s = sheet("2026", [
    ["Date", "Start address", "End address", "Miles", "Purpose", "Odometer start", "Odometer end"],
    ["2026-02-01", "SENTINEL_ADDRESS_A", "SENTINEL_ADDRESS_B", "12.34", "Patient draw", "1000", "1012"],
    ["2026-02-02", "", "", "", "Lab drop off", "2000", "2008"],
    ["2026-02-03", "", "", "5", "Personal", "", ""],
    ["2026-02-04", "", "", "5", "", "9", "3"],
    ["", "", "", "22.3", "", "", ""],
    ["2026-02-05", "", "", "1001", "", "", ""],
  ]);
  const r = M.parseMileage(at([s]));
  assert.deepEqual(r.rows.map((x) => [x.driven_on, x.miles_tenths, x.odometer_start]), [["2026-02-01", 123, 1000], ["2026-02-02", 80, 2000], ["2026-02-03", 50, null], ["2026-02-04", 50, null]]);
  assert.deepEqual(r.groups.map((g) => [g.label, g.guess]), [["Patient draw", "patient_visits"], ["Lab drop off", "lab_dropoff"], ["Personal", "skip"], ["No purpose given", "patient_visits"]]);
  assert.deepEqual([r.rounded, r.odometerDropped], [1, 1]);
  assert.deepEqual(r.flags.map((f) => f.reason), ["no date (a total line?)", "miles must be from 0.1 to 1000"]);
  const raw = M.serializeMileage(r);
  assert.doesNotMatch(raw, /SENTINEL|draw|Lab/);
  assert.deepEqual(M.parseMileagePayload(raw).rows, r.rows);
  const plan = M.planRows(r.rows, (x) => r.groups[x.group].guess !== "skip", new Set([r.rows[0].key]), { pair: (x) => `${x.driven_on}|${x.miles_tenths}`, counts: new Map([["2026-02-02|80", 1]]) });
  assert.deepEqual([plan.add.length, plan.notChosen, plan.alreadyImported, plan.matchedHandEntered], [1, 1, 1, 1]);
});

test("income: methods guessed (card payments left out), tips kept apart, payer column never read", () => {
  const s = sheet("Deposits", [
    ["Date", "Amount", "Tip", "Method", "Paid by", "Visits"],
    ["2026-03-01", "$120.00", "$10.00", "Check", "SENTINEL_PERSON", "2"],
    ["2026-03-02", "80", "", "Cash", "", ""],
    ["2026-03-03", "50", "", "Zelle", "", ""],
    ["2026-03-04", "40", "", "Credit card", "", ""],
    ["2026-03-05", "-20", "", "Cash", "", ""],
    ["", "290", "", "", "", ""],
  ]);
  const r = M.parseIncome(at([s]));
  assert.equal(r.hasTip, true);
  assert.deepEqual(r.rows.map((x) => [x.occurred_on, x.amount_cents, x.tip_cents, x.visits]), [["2026-03-01", 12000, 1000, 2], ["2026-03-02", 8000, 0, 0], ["2026-03-03", 5000, 0, 0], ["2026-03-04", 4000, 0, 0]]);
  assert.deepEqual(r.groups.map((g) => g.guess), ["check", "cash", "bank_transfer", "skip"]);
  assert.deepEqual(M.splitIncome(r.rows[0], false), { gross: 12000, tip: 1000 });
  assert.deepEqual(M.splitIncome(r.rows[0], true), { gross: 11000, tip: 1000 });
  assert.deepEqual(r.flags.map((f) => f.reason), ["negative amount (refunds are not imported)", "no date (a total line?)"]);
  const raw = M.serializeIncome(r);
  assert.doesNotMatch(raw, /SENTINEL|Check|Zelle/);
  assert.deepEqual(M.parseIncomePayload(raw).rows, r.rows);
  const j = JSON.parse(raw); j.rows[0][4] = 1;
  assert.equal(M.parseIncomePayload(JSON.stringify(j)), null, "an amount that doesn't match its key is refused");
});

test("Square item details: services per payment, refunds ignored, mixed payments left alone", () => {
  const s = sheet("items", [
    ["Date", "Item", "Qty", "Payment ID", "Transaction ID", "Event Type", "Customer Name", "PAN Suffix"],
    ["2026-04-01", "Mobile draw", "1", "PAY0001", "T1", "Payment", "SENTINEL_PERSON", "1234"],
    ["2026-04-01", "Trip fee", "1", "PAY0001", "T1", "Payment", "", ""],
    ["2026-04-02", "Mobile draw", "1", "PAY0002", "T2", "Payment", "", ""],
    ["2026-04-03", "Mobile draw", "1", "PAY0003", "T3", "Refund", "", ""],
    ["2026-04-04", "Specimen pickup", "1", "", "TXN4", "Payment", "", ""],
  ]);
  const r = M.parseServices(at([s]));
  assert.deepEqual(r.groups.map((g) => [g.label, g.count]), [["Mobile draw", 2], ["Trip fee", 1], ["Specimen pickup", 1]]);
  assert.deepEqual(r.payments, [{ external_id: "PAY0001", groups: [0, 1] }, { external_id: "PAY0002", groups: [0] }, { external_id: "t:TXN4", groups: [2] }]);
  assert.equal(r.refundsSkipped, 1);
  const raw = M.serializeServices(r);
  assert.doesNotMatch(raw, /SENTINEL|1234|Mobile/);
  assert.deepEqual(M.parseServicesPayload(raw).payments, r.payments);
  const plan = M.planServices(r.payments, new Map([[0, 41], [1, 42]]));
  assert.deepEqual(plan, { assign: [{ external_id: "PAY0002", account_id: 41 }], mixed: 1, unmapped: 1 });
  assert.equal(M.planServices(r.payments, new Map([[0, 41], [1, 41]])).assign.length, 2, "two services in the same account is fine");
});

test("version 13 adds only optional import key columns with unique indexes", () => {
  assert.ok(Sch.SCHEMA_VERSION >= 13);
  const all = Sch.schemaStatements.join("\n");
  for (const t of ["income_entries", "inventory_movements", "mileage_trips"]) {
    assert.match(all, new RegExp(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS import_key text`));
    assert.match(all, new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS ${t}_import_key_uq ON ${t} \\(import_key\\) WHERE import_key IS NOT NULL`));
  }
});
