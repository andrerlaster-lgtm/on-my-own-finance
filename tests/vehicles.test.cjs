const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const V = require("../.testbuild/vehicles.js"), E = require("../.testbuild/expenses.js"), A = require("../.testbuild/accounts.js"), L = require("../.testbuild/ledger.js");
const P = require("../.testbuild/packet.js"), R = require("../.testbuild/taxRules.js"), Inv = require("../.testbuild/lots.js"), S = require("../.testbuild/schema.js"), M = require("../.testbuild/mileage.js");
const rd = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

// ---------- forms ----------
test("vehicle names and service titles are short plain text: no plate/VIN-like or personal details", () => {
  assert.deepEqual(V.parseVehicleForm({ label: "Work car" }), { ok: true, value: { label: "Work car" } });
  for (const bad of ["", "   ", "x".repeat(41), "1HGCM82633A004352", "Plate 1234567", "me@example.com", "Car <b>"]) assert.equal(V.parseVehicleForm({ label: bad }).ok, false, bad);
  for (const bad of ["Oil change 12345", "x".repeat(61), "call me@x.com"]) assert.equal(V.parsePlannedForm({ vehicle_id: "1", title: bad, due_odometer: "1000" }).ok, false, bad);
});

test("a vehicle expense needs a vehicle, a real date, an amount above zero and one of the six categories", () => {
  assert.deepEqual(V.VEHICLE_CATEGORIES.map((c) => c.id), ["fuel", "maintenance", "repairs", "tires", "insurance", "parking_tolls"]);
  const f = (o) => V.parseVehicleExpenseForm({ vehicle_id: "3", spent_on: "2026-11-02", amount: "42.10", vehicle_category: "fuel", vendor: "Shell", odometer: "55123", receipt_on_file: "on", ...o });
  const ok = f({});
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { vehicle_id: 3, vehicle_category: "fuel", odometer: 55123, expense: { spent_on: "2026-11-02", amount_cents: 4210, category: "vehicle_fuel", vendor: "Shell", receipt_on_file: true } });
  for (const bad of [{ vehicle_id: "" }, { vehicle_id: "0" }, { spent_on: "2026-02-30" }, { amount: "0" }, { amount: "abc" }, { vehicle_category: "gas" }, { vehicle_category: "" }, { odometer: "12.5" }, { odometer: "99999999" }, { vendor: "a@b.com" }, { vendor: "Card 4111111111111111" }])
    assert.equal(f(bad).ok, false, JSON.stringify(bad));
  assert.equal(f({ odometer: "" }).value.odometer, null, "odometer is optional");
  assert.equal(f({ vendor: "" }).value.expense.vendor, null);
});

test("upcoming maintenance needs a due date or odometer; an estimate is optional and never an amount paid", () => {
  const f = (o) => V.parsePlannedForm({ vehicle_id: "1", title: "Oil change", ...o });
  assert.equal(f({}).ok, false, "no due date and no odometer");
  assert.deepEqual(f({ due_on: "2027-01-15", estimate: "89.99" }).value, { vehicle_id: 1, title: "Oil change", due_on: "2027-01-15", due_odometer: null, estimated_cost_cents: 8999 });
  assert.deepEqual(f({ due_odometer: "60000" }).value, { vehicle_id: 1, title: "Oil change", due_on: null, due_odometer: 60000, estimated_cost_cents: null });
  assert.equal(f({ due_on: "2027-13-01" }).ok, false); assert.equal(f({ due_odometer: "6e4" }).ok, false); assert.equal(f({ due_odometer: "1", estimate: "nope" }).ok, false);
});

test("completing a service: cost is optional; with a cost it needs the category; from a plan it never asks for a title", () => {
  const log = (o) => V.parseServiceForm({ vehicle_id: "2", title: "Brake pads", done_on: "2026-10-01", ...o }, false);
  assert.equal(log({}).value.cost, null, "no amount = a log line only, nothing to post");
  assert.deepEqual(log({ amount: "310.50", vehicle_category: "repairs", vendor: "Tire Shop", receipt_on_file: "on" }).value.cost, { amount_cents: 31050, vehicle_category: "repairs", vendor: "Tire Shop", receipt_on_file: true });
  assert.equal(log({ amount: "310.50" }).ok, false, "a paid amount needs a category");
  assert.equal(log({ amount: "310.50", vehicle_category: "repairs", done_on: "nope" }).ok, false);
  assert.equal(log({ title: "" }).ok, false);
  const done = V.parseServiceForm({ maintenance_id: "9", done_on: "2026-10-01", amount: "20", vehicle_category: "maintenance" }, true);
  assert.equal(done.ok, true); assert.equal(done.value.maintenance_id, 9);
  assert.equal(V.parseServiceForm({ done_on: "2026-10-01" }, true).ok, false, "needs the upcoming item");
});

// ---------- upcoming status ----------
test("upcoming items become due soon, then overdue, by date or by odometer", () => {
  const s = (it, today, odo) => V.dueStatus({ due_on: null, due_odometer: null, ...it }, today, odo);
  assert.equal(s({ due_on: "2026-12-31" }, "2026-11-04", null), "upcoming");
  assert.equal(s({ due_on: "2026-11-20" }, "2026-11-04", null), "due_soon");
  assert.equal(s({ due_on: "2026-11-04" }, "2026-11-04", null), "due_soon", "due today is not yet overdue");
  assert.equal(s({ due_on: "2026-11-03" }, "2026-11-04", null), "overdue");
  assert.equal(s({ due_odometer: 60000 }, "2026-11-04", 50000), "upcoming");
  assert.equal(s({ due_odometer: 60000 }, "2026-11-04", 59600), "due_soon");
  assert.equal(s({ due_odometer: 60000 }, "2026-11-04", 60000), "overdue");
  assert.equal(s({ due_odometer: 60000 }, "2026-11-04", null), "upcoming", "no odometer known: cannot say");
  assert.equal(s({ due_on: "2027-06-01", due_odometer: 60000 }, "2026-11-04", 61000), "overdue", "whichever comes first");
  assert.equal(V.plannedEstimateTotal([{ estimated_cost_cents: 100 }, { estimated_cost_cents: null }, { estimated_cost_cents: 250 }]), 350);
});

// ---------- totals ----------
const rows = [
  { spent_on: "2026-01-15", amount_cents: 4000, vehicle_id: 1, vehicle_category: "fuel" },
  { spent_on: "2026-01-20", amount_cents: 1500, vehicle_id: 2, vehicle_category: "parking_tolls" },
  { spent_on: "2026-02-03", amount_cents: 90000, vehicle_id: 1, vehicle_category: "tires" },
  { spent_on: "2026-02-28", amount_cents: 2500, vehicle_id: 1, vehicle_category: "fuel" },
  { spent_on: "2025-12-31", amount_cents: 777, vehicle_id: 1, vehicle_category: "fuel" },
  { spent_on: "2026-12-31", amount_cents: 1000, vehicle_id: 2, vehicle_category: "insurance" },
];
test("monthly and yearly totals, by vehicle and by category", () => {
  const year = V.spendingTotals(rows, { from: "2026-01-01", to: "2026-12-31" });
  assert.equal(year.total, 99000); assert.equal(year.count, 5);
  assert.deepEqual(year.byVehicle.map((v) => [v.vehicle_id, v.total, v.count]), [[1, 96500, 3], [2, 2500, 2]]);
  assert.deepEqual(year.byVehicle[0].byCategory, { fuel: 6500, tires: 90000 });
  assert.deepEqual(year.byCategory.map((c) => [c.id, c.total]), [["tires", 90000], ["fuel", 6500], ["parking_tolls", 1500], ["insurance", 1000]].sort((a, b) => b[1] - a[1]));
  const feb = V.spendingTotals(rows, V.monthRange(2026, 2));
  assert.equal(feb.total, 92500); assert.deepEqual(V.monthRange(2026, 2), { from: "2026-02-01", to: "2026-02-28" }); assert.equal(V.monthRange(2028, 2).to, "2028-02-29");
  const months = V.monthlyTotals(rows, 2026);
  assert.equal(months.length, 12); assert.equal(months[0], 5500); assert.equal(months[1], 92500); assert.equal(months[11], 1000);
  assert.equal(months.reduce((a, b) => a + b, 0), year.total, "months add up to the year, and other years are left out");
  assert.equal(V.spendingTotals([], { from: "2026-01-01", to: "2026-12-31" }).total, 0);
});

// ---------- actual spending vs tax-deductible ----------
const exp = (id, on, category, amount, vc) => ({ id, spent_on: on, amount_cents: amount, category, vendor: null, receipt_on_file: false, photos: 0, ...(vc ? { vehicle_category: vc } : {}) });
const STD = V.STANDARD_RULE, act = (pct, confirmed) => ({ method: "actual", businessUsePercent: pct, businessUseConfirmed: confirmed });
test("parking and tolls stay eligible and separately identifiable under BOTH methods; other vehicle costs follow the method", () => {
  const list = [exp(1, "2026-03-01", "supplies", 5000), exp(2, "2026-03-02", "vehicle_fuel", 4000, "fuel"), exp(3, "2026-03-03", "vehicle_fuel", 1500, "parking_tolls"), exp(4, "2026-03-04", "vehicle_fuel", 20000, "repairs")];
  assert.deepEqual(V.taxExpenses(list, () => STD).map((e) => [e.id, e.amount_cents]), [[1, 5000], [3, 1500]], "standard mileage: parking and tolls counted in full; fuel and repairs are not");
  assert.deepEqual(V.taxExpenses(list, () => act(null, false)).map((e) => e.id), [1, 3], "actual with no percentage: still parking and tolls only");
  assert.deepEqual(V.taxExpenses(list, () => act(80, false)).map((e) => e.id), [1, 3], "actual with an unconfirmed percentage: still parking and tolls only");
  assert.deepEqual(V.taxExpenses(list, () => act(80, true)).map((e) => [e.id, e.amount_cents]), [[1, 5000], [2, 3200], [3, 1500], [4, 16000]], "actual, confirmed 80%: the business-use share of fuel and repairs; parking and tolls in full (no allocation)");
  assert.deepEqual(V.taxExpenses(list, () => act(0, true)).map((e) => e.id), [1, 3], "0% confirmed counts nothing else");
  assert.equal(V.taxExpenses([exp(9, "2026-03-02", "vehicle_fuel", 999)], () => STD).length, 0, "a vehicle cost with no recorded kind is treated conservatively");
  assert.deepEqual(V.taxExpenses(list, (y) => (y === 2026 ? act(50, true) : STD)).map((e) => e.amount_cents), [5000, 2000, 1500, 10000], "the rule is per tax year");
  assert.equal(list[1].amount_cents, 4000, "the records themselves are never changed");
  assert.equal(V.isParkingTolls(list[2]), true); assert.equal(V.isParkingTolls(list[1]), false);
});

test("business-use allocation: validated, rounded to whole cents, and must be confirmed before anything is counted", () => {
  assert.equal(V.allocate(10001, 85), 8501); assert.equal(V.allocate(3333, 33.33), 1111); assert.equal(V.allocate(5, 50), 3); assert.equal(V.allocate(1000, 100), 1000); assert.equal(V.allocate(1000, 0), 0);
  assert.equal(V.parseBusinessUse(""), null); assert.equal(V.parseBusinessUse("85"), 85); assert.equal(V.parseBusinessUse("12.5"), 12.5); assert.equal(V.parseBusinessUse("100"), 100);
  for (const bad of ["101", "-5", "abc", "50%", "12.345", "1e2"]) assert.equal(V.parseBusinessUse(bad), "bad", bad);
  assert.equal(V.allocationStatus(STD), "standard"); assert.equal(V.allocationStatus(act(null, true)), "needs_percent"); assert.equal(V.allocationStatus(act(70, false)), "needs_confirmation"); assert.equal(V.allocationStatus(act(70, true)), "applied");
  const rows = [{ amount_cents: 10000, vehicle_category: "fuel" }, { amount_cents: 2000, vehicle_category: "parking_tolls" }];
  const std = V.vehicleTaxSummary(rows, STD), ap = V.vehicleTaxSummary(rows, act(75, true)), un = V.vehicleTaxSummary(rows, act(75, false));
  assert.deepEqual([std.actualSpendingCents, std.countedInTaxEstimatesCents, std.notCountedCents, std.parkingTollsCents, std.mileageApplies, std.warning], [12000, 2000, 10000, 2000, true, null]);
  assert.deepEqual([ap.actualSpendingCents, ap.countedInTaxEstimatesCents, ap.notCountedCents, ap.mileageApplies], [12000, 9500, 2500, false], "actual spending is preserved; only the counted share changes");
  assert.deepEqual([un.countedInTaxEstimatesCents, un.mileageApplies], [2000, false]); assert.match(un.warning, /not confirmed/); assert.match(V.vehicleTaxSummary(rows, act(null, false)).warning, /no business-use percentage/);
  assert.match(ap.warning, /mileage deduction is not applied/i);
  assert.equal(V.isTaxMethod("actual"), true); assert.equal(V.isTaxMethod("both"), false);
});

const packetFor = (expenses, over = {}, trips = []) => P.buildPacket({ year: 2026, income: [{ id: 1, occurred_on: "2026-03-10", source: "square", tax_form: "1099k", gross_cents: 100000, tip_cents: 0, fee_cents: 3000, visits: 1, imported: true, payer_id: null }],
  expenses, trips, rules: { ...R.emptyRules(2026), mileage_rate_cents: 70, mileage_rate_confirmed: true }, forms: [], payers: [], payments: [], inventory: Inv.inventoryReport([], [], "2026-01-01", "2026-12-31"), expiredLots: 0, lastImportRefunds: 0, ...over });
const trip = { id: 1, driven_on: "2026-03-01", miles_tenths: 1000, purpose: "supply_run", odometer_start: null, odometer_end: null };
const vlist = [exp(1, "2026-03-01", "supplies", 5000), exp(2, "2026-03-02", "vehicle_fuel", 4000, "fuel"), exp(3, "2026-03-03", "vehicle_fuel", 1500, "parking_tolls")];
test("year-end packet: parking and tolls counted and shown on their own line; other vehicle spending shown beside, not inside", () => {
  const std = packetFor(vlist);
  assert.equal(std.profit.expensesTotal, 6500); assert.equal(std.profit.estimatedProfit, 97000 - 6500);
  assert.deepEqual(std.vehicle, { method: "standard_mileage", allocation: "standard", businessUsePercent: null, businessUseConfirmed: false, spendingCents: 5500, count: 2, parkingTollsCents: 1500, countedCents: 1500, notCountedCents: 4000 });
  assert.deepEqual(std.expenses.byCategory.map((c) => [c.label, c.total]).sort(), [["Supplies", 5000], ["Vehicle: Parking and tolls", 1500]], "parking and tolls are their own line");
  assert.deepEqual(std.detail.expenses.map((e) => [e.category, e.amount_cents]), [["Supplies", 5000], ["Vehicle: Parking and tolls", 1500]]);
  assert.ok(std.readiness.some((r) => /parking and tolls\) is counted|4000|40\.00/.test(r.text)) || std.readiness.some((r) => /not, because the standard mileage rate/.test(r.text)));
  assert.equal(packetFor([exp(3, "2026-03-03", "vehicle_fuel", 1500, "parking_tolls")]).profit.estimatedProfit, 97000 - 1500, "parking and tolls count as an expense entry");
  const plain = packetFor([exp(1, "2026-03-01", "supplies", 5000)]);
  assert.deepEqual(plain.profit, packetFor([exp(1, "2026-03-01", "supplies", 5000)], { vehicleRule: act(80, true) }).profit, "years with no vehicle costs are unaffected");
});

test("actual expenses: the packet counts only the confirmed business-use share, keeps the spending record, and never presents the mileage deduction as applicable", () => {
  const none = packetFor(vlist, { vehicleRule: act(null, false) }, [trip]), unconf = packetFor(vlist, { vehicleRule: act(80, false) }, [trip]), ok = packetFor(vlist, { vehicleRule: act(80, true) }, [trip]);
  assert.equal(none.profit.expensesTotal, 6500, "no percentage: only parking and tolls on top of supplies"); assert.equal(unconf.profit.expensesTotal, 6500);
  assert.equal(ok.profit.expensesTotal, 5000 + 3200 + 1500, "80% of fuel plus parking and tolls in full");
  for (const p of [none, unconf, ok]) { assert.equal(p.vehicle.spendingCents, 5500, "the actual spending record is preserved in full"); assert.equal(p.vehicle.method, "actual"); }
  assert.deepEqual([ok.vehicle.allocation, ok.vehicle.businessUsePercent, ok.vehicle.countedCents, ok.vehicle.notCountedCents], ["applied", 80, 4700, 800]);
  assert.match(none.readiness.map((r) => r.text).join("|"), /no business-use percentage is entered/); assert.match(unconf.readiness.map((r) => r.text).join("|"), /not confirmed with your preparer/);
  // mileage: records and the computed figure stay, but it is not presented as an applicable deduction
  for (const p of [none, unconf, ok]) {
    assert.equal(p.mileage.applies, false); assert.equal(p.mileage.deductionCents, null); assert.equal(p.mileage.referenceDeductionCents, 7000, "kept for reference only");
    assert.equal(p.mileage.trips, 1); assert.equal(p.mileage.miles_tenths, 1000); assert.equal(p.mileage.centsPerMile, 70);
    assert.match(p.readiness.map((r) => r.text).join("|"), /mileage deduction is NOT applied/i);
    const summary = P.packetCsv(p, "summary"); assert.match(summary, /mileage_deduction_estimate_cents,\s*\n|mileage_deduction_estimate_cents,$/m); assert.match(summary, /mileage_deduction_applies,no/);
    assert.match(P.packetCsv(p, "mileage_detail"), /2026-03-01/, "the underlying mileage records are still exported");
  }
  const std = packetFor(vlist, {}, [trip]);
  assert.deepEqual([std.mileage.applies, std.mileage.deductionCents, std.mileage.referenceDeductionCents], [true, 7000, null], "standard mileage: the deduction estimate is exactly as before");
  assert.match(P.packetCsv(std, "summary"), /mileage_deduction_estimate_cents,7000/); assert.match(P.packetCsv(std, "summary"), /mileage_deduction_applies,yes/);
});

test("the mileage tracker and its calculations are untouched by vehicle costs", () => {
  const trips = [{ id: 1, driven_on: "2026-03-01", miles_tenths: 1000, purpose: "supply_run", odometer_start: null, odometer_end: null }];
  const rates = { 2026: { centsPerMile: 70, confirmed: true } };
  const m = M.mileageSummary(trips, { from: "2026-01-01", to: "2026-12-31" }, rates);
  assert.equal(m.deductionCents, 7000); // 100.0 miles x 70 cents
  const files = ["src/lib/mileage.ts", "src/app/mileage/page.tsx"];
  for (const f of files) assert.doesNotMatch(rd(f), /lib\/vehicles|vehicle_|Vehicle[A-Z]/, `${f} does not use the vehicle code`);
  assert.doesNotMatch(S.schemaStatements.filter((s) => /mileage_trips|mileage_pending/.test(s) && !/CREATE TABLE IF NOT EXISTS mileage_/.test(s) ).join(""), /vehicle/i);
});

// ---------- accounting: posted once, estimates never posted ----------
const accounts = A.DEFAULT_ACCOUNTS.map((d, i) => ({ id: i + 1, number: d.number, label: d.label, type: d.type, normal: d.normal, system_key: d.key, active: true }));
const ledgerOf = (expenses) => L.buildLedger({ accounts, income: [], expenses, movements: [], items: [], payments: [], manual: [] });
test("a paid vehicle expense posts exactly once to Vehicle expenses, balanced, against cash", () => {
  const veh = accounts.find((a) => a.system_key === "cat:vehicle_fuel");
  assert.ok(veh && veh.number === 6110 && veh.type === "operating_expense" && veh.label === "Vehicle expenses");
  const l = ledgerOf([exp(1, "2026-03-02", "vehicle_fuel", 4000), exp(2, "2026-03-03", "supplies", 500)]);
  assert.deepEqual(l.problems, []);
  assert.equal(l.entries.filter((e) => e.kind === "expense").length, 2, "one entry per expense row: nothing is added for a vehicle detail row");
  const e1 = l.entries.find((e) => e.key === "expense:1");
  assert.deepEqual(e1.lines.map((x) => [x.accountId === veh.id ? "veh" : "other", x.debit, x.credit]), [["veh", 4000, 0], ["other", 0, 4000]]);
  const debits = l.lines.reduce((s, x) => s + x.debit, 0), credits = l.lines.reduce((s, x) => s + x.credit, 0);
  assert.equal(debits, credits); assert.equal(debits, 4500 * 1);
  // posting the same list again gives the same ledger (calculated, never copied, so it cannot double up)
  assert.deepEqual(ledgerOf([exp(1, "2026-03-02", "vehicle_fuel", 4000), exp(2, "2026-03-03", "supplies", 500)]).lines, l.lines);
});

test("estimated and planned maintenance never reach the ledger or any report", () => {
  for (const f of ["src/lib/ledger.ts", "src/lib/accountingDb.ts", "src/lib/statements.ts", "src/lib/reports.ts", "src/lib/accountingPage.ts", "src/lib/accounts.ts"]) assert.doesNotMatch(rd(f), /vehicle_maintenance|estimated_cost|PlannedItem|MaintenanceRow/, `${f} cannot see maintenance plans`);
  assert.equal(L.buildLedger.length, 1);
  const input = Object.keys({ accounts: 1, income: 1, expenses: 1, movements: 1, items: 1, payments: 1, manual: 1 });
  assert.ok(!input.some((k) => /maint|plan|estimate/i.test(k)));
  const db = rd("src/lib/db.ts");
  const save = db.slice(db.indexOf("export async function saveService"), db.indexOf("export async function deleteMaintenance"));
  const expInsert = [...save.matchAll(/INSERT INTO expenses \([^)]*\)\s*SELECT ([^`]*?) FROM/g)].map((m) => m[1]);
  assert.ok(expInsert.length >= 1);
  for (const cols of expInsert) assert.doesNotMatch(cols, /estimated|due_/, "the estimate is never the amount posted; only the amount paid is");
  assert.match(save, /\$2::bigint IS NOT NULL/, "no amount entered = no expense row");
});

// ---------- database safety ----------
test("version 10 only adds new tables; money rows reuse expenses so receipts, backups and exports keep working", () => {
  assert.ok(S.SCHEMA_VERSION >= 11);
  const v10 = ["vehicles", "vehicle_expense_details", "vehicle_maintenance", "vehicle_tax_method"];
  for (const t of v10) { assert.ok(S.schemaStatements.some((s) => new RegExp(`^\\s*CREATE TABLE IF NOT EXISTS ${t} \\(`).test(s)), t); assert.ok(S.EXPORT_TABLES.includes(t), `${t} is exported and backed up`); }
  const alters = S.schemaStatements.filter((s) => /^\s*ALTER/i.test(s));
  assert.equal(alters.filter((s) => /ALTER TABLE vehicle/i.test(s)).length, 2, "the only vehicle ALTERs add the two business-use columns");
  assert.equal(alters.filter((s) => !/ALTER TABLE (expenses DROP CONSTRAINT IF EXISTS expenses_category_check, ADD CONSTRAINT expenses_category_check|tax_year_rules ADD COLUMN|vehicle_tax_method ADD COLUMN IF NOT EXISTS business_use_(percent|confirmed))/.test(s)).length, 0, "the only ALTERs are the earlier tax-rule columns, the one category list from version 9 and the two business-use columns");
  const body = (t) => new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(([\\s\\S]*?)\\n   \\)`).exec(S.schemaStatements.join("\n"))[1];
  assert.match(body("vehicle_expense_details"), /expense_id\s+bigint PRIMARY KEY REFERENCES expenses\(id\)/, "one detail row per expense: no second money record exists");
  assert.match(body("vehicle_maintenance"), /expense_id\s+bigint UNIQUE REFERENCES expenses\(id\)/, "a paid item points at its single expense");
  assert.match(body("vehicle_maintenance"), /CHECK \(status <> 'planned' OR due_on IS NOT NULL OR due_odometer IS NOT NULL\)/);
  assert.match(body("vehicle_maintenance"), /CHECK \(\(status = 'done'\) = \(done_on IS NOT NULL\)\)/);
  assert.match(body("vehicle_tax_method"), /method IN \('standard_mileage', 'actual'\)/);
  assert.ok(S.schemaStatements.at(-1).includes("schema_version"), "the version stamp stays last");
  const cols = S.schemaStatements.filter((s) => /^\s*CREATE (TABLE|INDEX) IF NOT EXISTS vehicle/.test(s)).join("\n").toLowerCase();
  for (const bad of ["plate", "vin ", "vin_", "driver", "patient", "address", "email", "phone", "notes"]) assert.ok(!cols.includes(bad), `no ${bad} column`);
  const F = require("../.testbuild/backupFormat.js");
  const at = (t) => F.RESTORE_ORDER.indexOf(t);
  assert.ok(at("expenses") < at("vehicle_expense_details") && at("vehicles") < at("vehicle_expense_details") && at("vehicles") < at("vehicle_maintenance") && at("expenses") < at("vehicle_maintenance"), "parents restore before children");
});

test("saving is atomic and double-tap safe; deleting an expense cleans up its vehicle rows without touching other records", () => {
  const db = rd("src/lib/db.ts");
  const add = db.slice(db.indexOf("export async function addVehicleExpense"), db.indexOf("export async function listMaintenance"));
  assert.equal([...add.matchAll(/sql\(\)\.query\(/g)].length, 1, "one statement saves the expense, its vehicle detail and its photo together");
  assert.match(add, /INSERT INTO expenses[\s\S]*INSERT INTO vehicle_expense_details[\s\S]*INSERT INTO expense_receipts/);
  const save = db.slice(db.indexOf("export async function saveService"), db.indexOf("export async function deleteMaintenance"));
  assert.match(save, /status = 'planned'\)?,?\s*\n?[\s\S]*?WHERE id IN \(SELECT id FROM m0\)/, "completing an item only affects an item still planned");
  assert.equal([...save.matchAll(/sql\(\)\.query\(/g)].length, 2, "one statement per path");
  const del = db.slice(db.indexOf("export async function deleteExpense"), db.indexOf("// ---- Vehicles"));
  assert.match(del, /DELETE FROM vehicle_expense_details WHERE expense_id/); assert.match(del, /UPDATE vehicle_maintenance SET expense_id = NULL/);
  assert.doesNotMatch(db.slice(db.indexOf("// ---- Vehicles"), db.indexOf("export async function countReceipts") === -1 ? undefined : db.length), /DELETE FROM (expenses|income_entries|journal)/ , "vehicle code never deletes ledger inputs by itself");
  assert.match(rd("src/lib/activity.ts"), /add_vehicle_expense/);
});

test("vehicle pages are gated, mobile-friendly with the existing styles, and the generic expense form cannot create untied vehicle costs", () => {
  for (const f of ["src/app/vehicles/page.tsx", "src/app/vehicles/expenses/page.tsx", "src/app/vehicles/maintenance/page.tsx"]) {
    const s = rd(f); assert.match(s, /requireOwner\(\)/); assert.match(s, /export const dynamic = "force-dynamic"/);
    assert.doesNotMatch(s, /style=\{\{[^}]*(width|minWidth): ?\d{3,}/, "no fixed wide layout");
  }
  assert.match(rd("src/app/vehicles/page.tsx"), /className="tablewrap"/, "wide tables scroll sideways instead of breaking the page");
  const e = rd("src/app/expenses/page.tsx");
  assert.match(e, /category === VEHICLE_EXPENSE_CATEGORY\) return fail/); assert.match(e, /filter\(\(c\) => c\.id !== VEHICLE_EXPENSE_CATEGORY\)/);
  assert.match(rd("src/components/Nav.tsx"), /href: "\/vehicles"/);
  assert.match(rd("src/app/page.tsx"), /taxExpenses\(allExps/, "dashboard estimates use the tax view");
});

// ---------- chart of accounts: 6110 can never silently clash ----------
test("the vehicle account never collides with an existing account: first free number, never skipped, nothing existing changed", () => {
  const st = S.schemaStatements.find((x) => /INSERT INTO accounts/.test(x));
  assert.match(st, /generate_series\(6110, 6899\)/); assert.match(st, /WHERE NOT EXISTS \(SELECT 1 FROM accounts WHERE number = n\)/);
  assert.match(st, /ORDER BY \(n % 10 <> 0\), n LIMIT 1/, "tidy multiples of ten first");
  assert.match(st, /NOT EXISTS \(SELECT 1 FROM accounts WHERE system_key = 'cat:vehicle_fuel'\)/, "never adds a second vehicle account");
  assert.doesNotMatch(st, /number = 6110 OR|OR number = 6110/, "a custom 6110 no longer makes the statement do nothing");
  assert.doesNotMatch(st, /ON CONFLICT|UPDATE|DELETE/, "no existing account is touched");
  assert.match(st, /WHERE EXISTS \(SELECT 1 FROM accounts\)/, "a new chart is seeded by the app instead");
  const L = require("../.testbuild/ledger.js");
  const noVeh = A.DEFAULT_ACCOUNTS.filter((d) => d.key !== "cat:vehicle_fuel").map((d, i) => ({ id: i + 1, number: d.number, label: d.label, type: d.type, normal: d.normal, system_key: d.key, active: true }));
  const missing = L.buildLedger({ accounts: noVeh, income: [], expenses: [exp(1, "2026-03-02", "vehicle_fuel", 4000, "fuel")], movements: [], items: [], payments: [], manual: [] });
  assert.match(missing.problems.join(" "), /cat:vehicle_fuel/, "if the account were ever missing the ledger says so loudly instead of dropping the cost quietly");
});
