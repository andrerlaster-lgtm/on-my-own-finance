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
const exp = (id, on, category, amount) => ({ id, spent_on: on, amount_cents: amount, category, vendor: null, receipt_on_file: false, photos: 0 });
test("tax estimates leave vehicle costs out under the standard mileage rate, and count them only for years set to actual", () => {
  const list = [exp(1, "2026-03-01", "supplies", 5000), exp(2, "2026-03-02", "vehicle_fuel", 4000), exp(3, "2025-03-02", "vehicle_fuel", 700)];
  assert.deepEqual(V.taxExpenses(list, () => "standard_mileage").map((e) => e.id), [1], "standard: fuel and repairs are not claimed on top of the mileage rate");
  assert.deepEqual(V.taxExpenses(list, () => "actual").map((e) => e.id), [1, 2, 3]);
  assert.deepEqual(V.taxExpenses(list, (y) => (y === 2026 ? "actual" : "standard_mileage")).map((e) => e.id), [1, 2], "the choice is per tax year");
  assert.equal(V.isVehicleCost({ category: "supplies" }), false);
  const t = V.taxTreatment("standard_mileage", 40000, 12000);
  assert.deepEqual([t.actualSpendingCents, t.countedInTaxEstimatesCents, t.notClaimedCents, t.mileageDeductionCents, t.warning], [40000, 0, 40000, 12000, null]);
  const a = V.taxTreatment("actual", 40000, 12000);
  assert.deepEqual([a.countedInTaxEstimatesCents, a.notClaimedCents, a.mileageDeductionCents], [40000, 0, null], "actual: the mileage deduction is not used");
  assert.match(a.warning, /do not also claim the mileage deduction/i);
  assert.equal(V.isTaxMethod("actual"), true); assert.equal(V.isTaxMethod("both"), false);
});

const packetFor = (expenses, over = {}) => P.buildPacket({ year: 2026, income: [{ id: 1, occurred_on: "2026-03-10", source: "square", tax_form: "1099k", gross_cents: 100000, tip_cents: 0, fee_cents: 3000, visits: 1, imported: true, payer_id: null }],
  expenses, trips: [], rules: R.emptyRules(2026), forms: [], payers: [], payments: [], inventory: Inv.inventoryReport([], [], "2026-01-01", "2026-12-31"), expiredLots: 0, lastImportRefunds: 0, ...over });
test("year-end packet: vehicle spending is shown beside the figures, and counted only under actual expenses", () => {
  const list = [exp(1, "2026-03-01", "supplies", 5000), exp(2, "2026-03-02", "vehicle_fuel", 4000)];
  const std = packetFor(list), act = packetFor(list, { vehicleMethod: "actual" });
  assert.equal(std.profit.expensesTotal, 5000); assert.equal(std.profit.estimatedProfit, 97000 - 5000);
  assert.deepEqual(std.vehicle, { method: "standard_mileage", spendingCents: 4000, count: 1, countedCents: 0, notClaimedCents: 4000 });
  assert.equal(act.profit.expensesTotal, 9000); assert.equal(act.vehicle.countedCents, 4000); assert.equal(act.vehicle.notClaimedCents, 0);
  assert.equal(std.detail.expenses.length, 1, "the expense list handed to the preparer has no vehicle costs under the standard rate");
  assert.ok(std.readiness.some((r) => /NOT counted/.test(r.text)) && act.readiness.some((r) => /do not also claim the mileage deduction/i.test(r.text)));
  const only = packetFor([exp(2, "2026-03-02", "vehicle_fuel", 4000)]);
  assert.equal(only.profit.estimatedProfit, null, "vehicle costs alone never make a period look like it has expenses entered");
  // years with no vehicle costs are unchanged by the feature
  const plain = packetFor([exp(1, "2026-03-01", "supplies", 5000)]);
  assert.deepEqual(plain.profit, packetFor([exp(1, "2026-03-01", "supplies", 5000)], { vehicleMethod: "actual" }).profit);
  assert.equal(plain.vehicle.spendingCents, 0);
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
  assert.ok(S.SCHEMA_VERSION >= 10);
  const v10 = ["vehicles", "vehicle_expense_details", "vehicle_maintenance", "vehicle_tax_method"];
  for (const t of v10) { assert.ok(S.schemaStatements.some((s) => new RegExp(`^\\s*CREATE TABLE IF NOT EXISTS ${t} \\(`).test(s)), t); assert.ok(S.EXPORT_TABLES.includes(t), `${t} is exported and backed up`); }
  const alters = S.schemaStatements.filter((s) => /^\s*ALTER/i.test(s));
  assert.equal(alters.filter((s) => /ALTER TABLE vehicle/i.test(s)).length, 0);
  assert.equal(alters.filter((s) => !/ALTER TABLE (expenses DROP CONSTRAINT IF EXISTS expenses_category_check, ADD CONSTRAINT expenses_category_check|tax_year_rules ADD COLUMN)/.test(s)).length, 0, "the only ALTERs are the earlier tax-rule columns and the one category list from version 9; vehicles alter nothing");
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
  assert.match(rd("src/app/page.tsx"), /taxExpenses\(exps/, "dashboard estimates use the tax view");
});
