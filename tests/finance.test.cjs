const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const F = require("../.testbuild/finance.js"), S = require("../.testbuild/schema.js"), B = require("../.testbuild/backupFormat.js"), I = require("../.testbuild/inventory.js"), X = require("../.testbuild/schedule.js");
const rd = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const KEY = "abcd1234-efgh";

// ---------- price and status ----------
test("price is stored in cents; blank means not decided, 0 is an explicit no-charge service", () => {
  assert.equal(F.parsePrice(""), null); assert.equal(F.parsePrice("   "), null); assert.equal(F.parsePrice("0"), 0); assert.equal(F.parsePrice("0.00"), 0);
  assert.equal(F.parsePrice("120"), 12000); assert.equal(F.parsePrice("120.5"), 12050); assert.equal(F.parsePrice("1,200.00"), 120000 > 0 ? F.parsePrice("1,200.00") : 0);
  for (const bad of ["abc", "-5", "12.345", "1e3", "999999999999.99"]) assert.equal(F.parsePrice(bad), "bad", bad);
  const f = (o) => X.parseAppointmentForm({ date: "2026-11-04", time: "09:30", type: "office", service_code: "blood_draw", ...o }, [{ code: "blood_draw", active: true }]);
  assert.equal(f({ price: "120" }).value.price_cents, 12000); assert.equal(f({ price: "0" }).value.price_cents, 0); assert.equal(f({}).value.price_cents, null); assert.equal(f({ price: "x" }).ok, false);
  // a recorded price can be corrected but never silently erased; and the hidden 30-minute window is unchanged
  assert.equal(X.parseAppointmentForm({ date: "2026-11-04", time: "09:30", type: "office", service_code: "blood_draw", price: "" }, [{ code: "blood_draw", active: true }], 30, 5000).ok, false);
  assert.equal(X.parseAppointmentForm({ date: "2026-11-04", time: "09:30", type: "office", service_code: "blood_draw", price: "" }, [{ code: "blood_draw", active: true }], 30, null).ok, true);
  assert.equal(f({ price: "10" }).value.ends_at - f({ price: "10" }).value.starts_at, 30 * 60000);
  assert.deepEqual(X.DEFAULT_SERVICES.map((s) => s.label), ["Blood Draw", "Gender Reveal Testing", "Therapeutic Draw", "Travel Lab"], "the four services are preserved");
});

test("payment status and the one-line label: Completed / Paid, Unpaid, Partially Paid, No charge", () => {
  assert.equal(F.financeLabel("completed", 12000, 12000), "Completed / Paid"); assert.equal(F.financeLabel("completed", 12000, 0), "Completed / Unpaid");
  assert.equal(F.financeLabel("completed", 12000, 5000), "Completed / Partially Paid"); assert.equal(F.financeLabel("completed", 0, 0), "Completed / No charge");
  assert.equal(F.financeLabel("scheduled", 12000, 0), "Expected"); assert.equal(F.financeLabel("confirmed", 12000, 3000), "Expected (advance paid)"); assert.equal(F.financeLabel("scheduled", null, 0), "No price set"); assert.equal(F.financeLabel("canceled", 12000, 0), "Canceled");
  assert.equal(F.balanceOf(12000, 5000), 7000); assert.equal(F.balanceOf(12000, 12000), 0); assert.equal(F.balanceOf(null, 0), 0);
});

test("expected revenue covers only open appointments; receivables only completed ones; canceled counts in neither", () => {
  const list = [{ status: "scheduled", price_cents: 12000, paid_cents: 0 }, { status: "confirmed", price_cents: 8000, paid_cents: 3000 }, { status: "canceled", price_cents: 9000, paid_cents: 0 },
    { status: "completed", price_cents: 12000, paid_cents: 5000 }, { status: "completed", price_cents: 100, paid_cents: 100 }, { status: "scheduled", price_cents: null, paid_cents: 0 }, { status: "completed", price_cents: 0, paid_cents: 0 }];
  assert.equal(F.expectedRevenue(list), 12000 + 5000, "advance payments are already income, so only the rest is still expected");
  assert.equal(F.receivableTotal(list), 7000, "unpaid scheduled work is not a receivable; a paid or $0 completed one owes nothing");
  assert.equal(F.expectedRevenue([{ status: "canceled", price_cents: 9000, paid_cents: 0 }]), 0);
});

// ---------- the forms ----------
test("payment form: real amount up to the balance, a listed method, a real past-or-today date, a clean Square ID", () => {
  const f = (o, bal = 7000) => F.parsePaymentForm({ amount: "50", method: "cash", paid_on: "2026-11-03", request_key: KEY, ...o }, bal, "2026-11-04");
  assert.deepEqual(f({}).value, { amount_cents: 5000, method: "cash", paid_on: "2026-11-03", square_payment_id: null, request_key: KEY });
  for (const m of ["cash", "check", "bank_transfer", "square", "other"]) assert.equal(f({ method: m }).ok, true, m);
  assert.deepEqual(F.PAYMENT_METHODS.map((m) => m.label), ["Cash", "Check", "Bank transfer", "Square / Card", "Other"]);
  for (const bad of [{ amount: "0" }, { amount: "-1" }, { amount: "abc" }, { amount: "70.01" }, { method: "bitcoin" }, { method: "" }, { paid_on: "2026-11-05" }, { paid_on: "nope" }, { request_key: "x" }, { request_key: "" }, { square_payment_id: "ID1" }, { method: "square", square_payment_id: "has space" }, { method: "square", square_payment_id: "a".repeat(70) }])
    assert.equal(f(bad).ok, false, JSON.stringify(bad));
  assert.equal(f({ amount: "70" }).ok, true); assert.equal(f({ method: "square", square_payment_id: "ABC_123-x" }).value.square_payment_id, "ABC_123-x");
  assert.equal(F.parsePaymentForm({ amount: "1", method: "cash", paid_on: "2026-11-03", request_key: KEY }, 0, "2026-11-04").ok, false, "nothing can be paid on a settled balance");
});

test("completion form: price required, payment optional (empty or 0 = unpaid), supplies optional and strict", () => {
  const f = (o, price = null, paid = 0) => F.parseCompletionForm({ price: "120", amount: "50", method: "check", paid_on: "2026-11-03", request_key: KEY, ...o }, price, paid, "2026-11-04");
  const ok = f({ qty_7: "2", qty_9: "1", qty_3: "0", qty_4: "" });
  assert.equal(ok.ok, true); assert.deepEqual(ok.value.supplies, [{ item_id: 7, quantity: 2 }, { item_id: 9, quantity: 1 }], "zero and empty rows are not supplies, and order is stable");
  assert.deepEqual([ok.value.price_cents, ok.value.payment.amount_cents], [12000, 5000]);
  assert.equal(f({ amount: "" }).value.payment, null, "unpaid: no payment"); assert.equal(f({ amount: "0" }).value.payment, null); assert.equal(f({ amount: "0.00" }).value.payment, null);
  assert.equal(f({ price: "" }).ok, false, "a price is needed (0 if free)"); assert.equal(f({ price: "" }, 12000).value.price_cents, 12000, "or the one already recorded"); assert.equal(f({ price: "0", amount: "" }).value.price_cents, 0);
  assert.equal(f({ amount: "121" }).ok, false, "can't receive more than the price"); assert.equal(f({ amount: "70" }, 12000, 5000).ok, true, "advance already received is part of the price"); assert.equal(f({ amount: "70.01" }, 12000, 5000).ok, false);
  assert.equal(f({ price: "40" }, 12000, 5000).ok, false, "the price can't drop below what was already received ($40 < $50)");
  for (const bad of [{ qty_7: "-1" }, { qty_7: "1.5" }, { qty_7: "abc" }, { qty_7: "2000000" }]) assert.equal(f(bad).ok, false, JSON.stringify(bad));
  assert.equal(f({ amount: "50", method: "" }).ok, false, "a payment needs its method");
});

// ---------- supplies use the Inventory rules ----------
const mv = (id, item, on, kind, q, cost = null, lot = null, exp = null) => ({ id, item_id: item, moved_on: on, kind, quantity: q, unit_cost_cents: cost, reason: null, lot_number: lot, expires_on: exp });
test("supplies are checked with the existing inventory rules: never negative, earliest-expiring lot first, and a stock token for concurrency", () => {
  const needles = { id: 1, label: "Butterfly needles", movements: [mv(1, 1, "2026-10-01", "opening", 50, 100)], lotUses: [] };
  const pads = { id: 2, label: "Alcohol pads", movements: [mv(2, 2, "2026-10-01", "purchase", 100, 5, "A", "2027-06-01"), mv(3, 2, "2026-10-02", "purchase", 100, 5, "B", "2026-12-01")], lotUses: [] };
  const gauze = { id: 3, label: "Gauze", movements: [mv(4, 3, "2026-10-01", "opening", 3, 20)], lotUses: [] };
  let p = F.planSupplies([{ item_id: 1, quantity: 2 }, { item_id: 2, quantity: 2 }, { item_id: 3, quantity: 1 }], [needles, pads, gauze], "2026-11-02");
  assert.equal(p.ok, true); assert.deepEqual(p.uses.map((u) => [u.item_id, u.quantity, u.moved_on]), [[1, 2, "2026-11-02"], [2, 2, "2026-11-02"], [3, 1, "2026-11-02"]]);
  assert.deepEqual(p.uses[1].allocations, [{ lot_number: "B", quantity: 2 }], "lot B expires first"); assert.deepEqual(p.uses[0].allocations, [], "an item without lots has none");
  assert.deepEqual(p.uses[0].expect, { movements: 1, max_id: 1, lot_uses: 0 }, "the token the database re-checks under its lock");
  p = F.planSupplies([{ item_id: 2, quantity: 150 }], [pads], "2026-11-02"); assert.deepEqual(p.uses[0].allocations, [{ lot_number: "B", quantity: 100 }, { lot_number: "A", quantity: 50 }]);
  p = F.planSupplies([{ item_id: 3, quantity: 4 }], [gauze], "2026-11-02"); assert.equal(p.ok, false); assert.match(p.error, /Gauze: Not enough on hand/);
  p = F.planSupplies([{ item_id: 1, quantity: 51 }], [needles], "2026-11-02"); assert.equal(p.ok, false, "negative inventory is refused");
  p = F.planSupplies([{ item_id: 1, quantity: 5 }], [needles], "2026-09-01"); assert.equal(p.ok, false, "stock that had not arrived yet on the service date is refused");
  assert.equal(F.planSupplies([{ item_id: 99, quantity: 1 }], [needles], "2026-11-02").ok, false); assert.equal(F.planSupplies([], [needles], "2026-11-02").ok, true, "supplies are optional");
  assert.deepEqual(F.stockToken([mv(5, 1, "2026-10-01", "opening", 1, 1), mv(9, 1, "2026-10-02", "use", 1)], [{ movement_id: 9, lot_number: "A", quantity: 1 }]), { movements: 2, max_id: 9, lot_uses: 1 });
});

test("reorder warning: the existing threshold rule, reached or passed (the 50 - 42 = 8 example with level 10)", () => {
  const stockAfter = (start, used) => start - used;
  assert.equal(I.isLowStock(stockAfter(50, 2), 10), false); assert.equal(I.isLowStock(stockAfter(50, 40), 10), true, "reaches the level"); assert.equal(I.isLowStock(stockAfter(50, 42), 10), true, "falls below it");
  assert.deepEqual(F.reorderNeeded([{ label: "Needles", onHand: 8, reorder_level: 10 }, { label: "Pads", onHand: 100, reorder_level: 20 }, { label: "Gauze", onHand: 0, reorder_level: null }]).map((i) => i.label), ["Needles"], "an item with no level is never flagged");
  assert.match(strip(rd("src/lib/finance.ts")), /import \{[^}]*isLowStock[^}]*\} from "\.\/inventory"/, "reuses the inventory rule, no second warning system");
  assert.doesNotMatch(strip(rd("src/lib/finance.ts")), /<=\s*[a-z.]*reorder/i);
  for (const f of ["src/app/page.tsx", "src/app/inventory/page.tsx"]) assert.match(rd(f), /Reorder needed/, `${f} shows the warning`);
  assert.match(rd("src/app/secretary/[id]/page.tsx"), /Reorder needed/); assert.match(rd("src/app/secretary/[id]/complete/page.tsx"), /reorder needed/);
});

test("database error codes become plain sentences", () => {
  assert.match(F.dbErrorText("error: OMOF:ALREADY_COMPLETED"), /already completed/); assert.match(F.dbErrorText("OMOF:NEGATIVE_STOCK"), /not enough stock/); assert.match(F.dbErrorText("OMOF:OVERPAYMENT"), /more than the remaining balance/);
  assert.match(F.dbErrorText("OMOF:SQUARE_LINKED"), /already linked/); assert.equal(F.dbErrorText("connection reset"), null, "anything else is not hidden behind a friendly message"); assert.equal(F.dbErrorCode("x OMOF:STALE_INVENTORY y"), "STALE_INVENTORY");
});

// ---------- the database: one transaction, one income row per payment, Square never double counted ----------
const stmts = S.schemaStatements, fn = (name) => stmts.find((s) => new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\(`).test(s));
test("version 11 adds a price and completion time, three new tables and three functions, and nothing destructive", () => {
  assert.ok(S.SCHEMA_VERSION >= 11);
  const alters = stmts.filter((s) => /^\s*ALTER TABLE appointments/.test(s));
  assert.equal(alters.length, 2); for (const a of alters) assert.match(a, /^ALTER TABLE appointments ADD COLUMN IF NOT EXISTS (price_cents bigint|completed_at timestamptz)/);
  for (const t of ["appointment_payments", "appointment_supply_uses"]) assert.ok(stmts.some((s) => new RegExp(`^\\s*CREATE TABLE IF NOT EXISTS ${t} \\(`).test(s)), t);
  const v11 = stmts.slice(stmts.findIndex((s) => /ALTER TABLE appointments ADD COLUMN IF NOT EXISTS price_cents/.test(s)), -1).join("\n");
  assert.doesNotMatch(v11, /\b(DROP|TRUNCATE|DELETE)\b/i, "no deletion anywhere in the version 11 statements, functions included");
  assert.doesNotMatch(v11, /UPDATE (income_entries|inventory_|expenses|journal|accounts)/i, "never rewrites income, stock or accounting rows");
  assert.ok(stmts.at(-1).includes("schema_version"));
});

test("a payment is one row linked to at most one income entry; a Square payment can never be linked or ID-matched twice", () => {
  const t = stmts.find((s) => /CREATE TABLE IF NOT EXISTS appointment_payments/.test(s));
  assert.match(t, /request_key\s+text NOT NULL UNIQUE/, "a repeated form submission cannot add a second payment");
  assert.match(t, /income_entry_id\s+bigint REFERENCES income_entries\(id\)/); assert.match(t, /method text NOT NULL CHECK \(method IN \('cash', 'check', 'bank_transfer', 'square', 'other'\)\)|method\s+text NOT NULL CHECK \(method IN \('cash', 'check', 'bank_transfer', 'square', 'other'\)\)/);
  assert.match(t, /CHECK \(\(method = 'square'\) = \(reconcile_state <> 'none'\)\)/); assert.match(t, /CHECK \(\(reconcile_state = 'awaiting_square'\) = \(income_entry_id IS NULL\)\)/, "a waiting Square payment has no income of its own");
  assert.ok(stmts.some((s) => /CREATE UNIQUE INDEX IF NOT EXISTS appointment_payments_income_uq ON appointment_payments \(income_entry_id\) WHERE income_entry_id IS NOT NULL/.test(s)), "one income entry can back only one payment");
  assert.ok(stmts.some((s) => /CREATE UNIQUE INDEX IF NOT EXISTS appointment_payments_square_uq ON appointment_payments \(square_payment_id\) WHERE square_payment_id IS NOT NULL/.test(s)), "one Square ID can back only one payment");
  const pay = fn("app_record_payment");
  assert.match(pay, /IF p_method = 'square' THEN[\s\S]*?ELSE\s+INSERT INTO income_entries/, "income is inserted only on the non-Square branch");
  assert.equal([...pay.matchAll(/INSERT INTO income_entries/g)].length, 1, "exactly one place creates income");
  assert.match(pay, /external_id = p_square/); assert.doesNotMatch(pay, /occurred_on\s*=\s*p_paid_on|gross_cents\s*=\s*p_amount\s+AND[^;]*occurred_on/i, "no match by amount and date");
  assert.match(pay, /SQUARE_MISMATCH/); assert.match(pay, /SQUARE_LINKED/); assert.match(pay, /OVERPAYMENT/); assert.match(pay, /OMOF:CANCELED/);
  assert.match(pay, /WHERE request_key = p_key[\s\S]*RETURN v_prev/, "a repeated key returns the first payment");
  const db = strip(rd("src/lib/db.ts"));
  assert.match(db, /export async function reconcileSquareAuto[\s\S]*?e\.external_id = p\.square_payment_id[\s\S]*?e\.gross_cents = p\.amount_cents/, "automatic linking is by exact Square payment ID");
  assert.doesNotMatch(db.slice(db.indexOf("export async function reconcileSquareAuto"), db.indexOf("export async function financeTotals")), /occurred_on\s*=\s*p\.paid_on/, "never by date");
  assert.match(db, /if \(\(\(await schemaVersion\(\)\) \?\? 0\) >= 11\) await reconcileSquareAuto\(\)/, "after an import");
  assert.match(db, /ON CONFLICT \(source, external_id\) WHERE external_id IS NOT NULL DO NOTHING/, "the existing Square import is unchanged");
  for (const f of ["src/lib/squareImport.ts", "src/lib/squareFormat.ts"]) assert.doesNotMatch(rd(f), /appointment/i, `${f} is untouched`);
});

test("completion is one database call: locks the appointment and stock, checks stale stock and negative stock, and marks it completed last", () => {
  const c = fn("complete_appointment");
  assert.match(c, /FROM appointments WHERE id = v_id FOR UPDATE/); assert.match(c, /ALREADY_COMPLETED/); assert.match(c, /NOT_STARTED/); assert.match(c, /NO_PRICE/); assert.match(c, /PRICE_BELOW_PAID/);
  assert.match(c, /FROM inventory_items WHERE id IN[\s\S]*?ORDER BY id FOR UPDATE/, "stock rows locked in a fixed order");
  assert.match(c, /OMOF:STALE_INVENTORY/); assert.match(c, /OMOF:NEGATIVE_STOCK/);
  assert.match(c, /INSERT INTO inventory_movements \(item_id, moved_on, kind, quantity\) VALUES \(v_item, \(s->>'moved_on'\)::date, 'use'/, "supplies are ordinary 'use' movements (existing valuation and cost rules)");
  assert.match(c, /INSERT INTO inventory_lot_uses/); assert.match(c, /INSERT INTO appointment_supply_uses \(appointment_id, movement_id\)/);
  assert.ok(c.indexOf("app_record_payment(") < c.indexOf("INSERT INTO inventory_movements") && c.indexOf("INSERT INTO inventory_movements") < c.indexOf("SET status = 'completed'"), "the status changes only after payment and supplies are in");
  assert.equal([...c.matchAll(/SET status = 'completed'/g)].length, 1); assert.doesNotMatch(c, /INSERT INTO expenses|INSERT INTO journal/, "no duplicate expense or ledger entry");
  const supplies = stmts.find((s) => /CREATE TABLE IF NOT EXISTS appointment_supply_uses/.test(s)); assert.match(supplies, /movement_id\s+bigint NOT NULL UNIQUE REFERENCES inventory_movements\(id\)/, "one movement belongs to one appointment, once");
  const db = strip(rd("src/lib/db.ts")), body = db.slice(db.indexOf("export async function completeAppointment"), db.indexOf("export interface ReceivableRow"));
  assert.equal([...body.matchAll(/complete_appointment\(\$1::jsonb\)/g)].length, 1, "a single call does the whole save"); assert.doesNotMatch(body, /INSERT INTO|UPDATE |addMovement|addIncome/, "no piecemeal writes from the app");
  assert.match(body, /STALE_INVENTORY" && attempt === 0\) continue/, "stale stock is re-checked once automatically");
  assert.match(db, /AND \$2 <> 'completed' AND \$3 <> 'completed' RETURNING id/, "completed is final, and nothing becomes completed except through the workflow");
});

test("the screens: one completion form, no direct completion shortcut, everything gated, a payment form that cannot double submit", () => {
  const page = rd("src/app/secretary/[id]/complete/page.tsx");
  assert.equal([...strip(page).matchAll(/completeAppointment\(/g)].length, 1); assert.doesNotMatch(strip(page), /recordAppointmentPayment|addMovement|setAppointmentStatus/);
  assert.match(page, /name="id"/); assert.match(page, /qty_\$\{i\.id\}/); assert.match(page, /requestKey=\{crypto\.randomUUID\(\)\}/, "each rendering of the form has its own one-time key");
  for (const t of ["Service", "Payment", "Supplies used"]) assert.match(page, new RegExp(`<h2>${t}`));
  const detail = rd("src/app/secretary/[id]/page.tsx");
  assert.match(detail, /if \(to === "completed"\) redirect\(`\/secretary\/\$\{id\}\/complete`\)/, "Mark completed always opens the workflow");
  for (const f of ["src/app/secretary/[id]/complete/page.tsx", "src/app/receivables/page.tsx", "src/app/secretary/[id]/page.tsx"]) {
    assert.match(rd(f), /export const dynamic = "force-dynamic"/, f);
    for (const m of rd(f).matchAll(/"use server";\s*\n\s*(.*)/g)) assert.match(m[1], /requireOwner/, `${f}: action without an access check`);
    assert.match(rd(f), /requireOwner\(\)/, f);
  }
  const ar = rd("src/app/receivables/page.tsx");
  for (const h of ["Appt", "Service", "Service date", "Price", "Paid", "Balance", "Status"]) assert.match(ar, new RegExp(`<th>${h}</th>`), h);
  assert.match(rd("src/components/Nav.tsx"), /href: "\/receivables", label: "Receivables"/);
  assert.match(rd("src/components/PaymentFields.tsx"), /name="request_key"/);
});

// ---------- privacy and accounting isolation ----------
test("no new field can hold a name, phone, address, date of birth, diagnosis or free text", () => {
  const body = (t) => new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(([\\s\\S]*?)\\n   \\)`).exec(stmts.join("\n"))[1];
  const cols = (t) => body(t).split("\n").map((l) => l.trim().split(/\s+/)[0].toLowerCase()).filter((c) => /^[a-z_]+$/.test(c) && !["check", "exclude"].includes(c)).sort();
  assert.deepEqual(cols("appointment_payments"), ["amount_cents", "appointment_id", "created_at", "id", "income_entry_id", "method", "paid_on", "reconcile_state", "request_key", "square_payment_id"].sort());
  assert.deepEqual(cols("appointment_supply_uses"), ["appointment_id", "created_at", "id", "movement_id"]);
  assert.match(body("appointment_payments"), /square_payment_id text CHECK \(square_payment_id IS NULL OR square_payment_id ~ '\^\(t:\)\?\[A-Za-z0-9_-\]\{1,64\}\$'\)/, "the only typed value is a machine reference with no spaces");
  const ui = ["src/app/secretary/[id]/page.tsx", "src/app/secretary/[id]/complete/page.tsx", "src/app/receivables/page.tsx", "src/components/AppointmentForm.tsx"].map(rd).join("\n");
  assert.doesNotMatch(ui, /<textarea|type="text"|type="tel"|type="email"|name="(name|phone|address|note|notes|memo)"/, "no free-text input on any appointment screen");
  const fields = rd("src/components/PaymentFields.tsx"); assert.equal([...fields.matchAll(/type="text"/g)].length, 1); assert.match(fields, /type="text"[^>]*maxLength=\{70\}[^>]*placeholder="copy from Square"|name="square_payment_id" type="text"/);
  assert.doesNotMatch(strip(rd("src/lib/finance.ts")), /patient|phone|address|birth|diagnos/i);
});

test("the ledger, reports and tax code are untouched and cannot see receivables or payments; income is only ever the money received", () => {
  for (const f of ["src/lib/ledger.ts", "src/lib/statements.ts", "src/lib/reports.ts", "src/lib/accounts.ts", "src/lib/accountingDb.ts", "src/lib/packet.ts", "src/lib/taxforms.ts", "src/lib/income.ts", "src/lib/squareImport.ts"]) assert.doesNotMatch(rd(f), /appointment/i, `${f} knows nothing about appointments`);
  for (const f of ["src/lib/ledger.ts", "src/lib/statements.ts", "src/lib/reports.ts", "src/lib/accountingDb.ts", "src/lib/packet.ts", "src/lib/income.ts"]) assert.doesNotMatch(rd(f), /receivable/i, `${f} does not post or report receivables (the cash-basis books count money received only)`);
  const db = strip(rd("src/lib/db.ts")), fin = db.slice(db.indexOf("// ---- Appointment money and supplies"));
  assert.doesNotMatch(fin, /INSERT INTO (income_entries|expenses|journal)|UPDATE income_entries|DELETE FROM/, "the app code never writes income directly: only the payment function does, once per payment");
  assert.doesNotMatch(fin.slice(fin.indexOf("export async function listReceivables"), fin.indexOf("export interface AwaitingSquare")), /income_entries/, "receivables are computed from price and payments, not income");
  assert.match(rd("src/lib/finance.ts"), /A RECEIVABLE exists only for a COMPLETED appointment and is just price minus payments/);
  // refunds and corrections are never automatic
  assert.doesNotMatch(strip(rd("src/lib/db.ts")).slice(strip(rd("src/lib/db.ts")).indexOf("// ---- Appointment money and supplies")), /refund|reverse|DELETE FROM appointment_payments/i);
  assert.match(rd("src/lib/db.ts"), /23503|foreign key/, "income that backs an appointment payment cannot be deleted from the Income page");
});

test("new tables are in the export, the backup and the restore order (parents first), and the restore script upserts the seeded service list", () => {
  for (const t of ["appointment_payments", "appointment_supply_uses"]) { assert.ok(S.EXPORT_TABLES.includes(t), `${t} exported`); assert.ok(B.RESTORE_ORDER.includes(t), `${t} restored`); }
  const at = (t) => B.RESTORE_ORDER.indexOf(t);
  assert.ok(at("appointments") < at("appointment_payments") && at("income_entries") < at("appointment_payments"), "payments restore after appointments and income");
  assert.ok(at("inventory_movements") < at("appointment_supply_uses") && at("appointments") < at("appointment_supply_uses"), "supply links restore after appointments and movements");
  assert.deepEqual([...B.RESTORE_ORDER].sort(), [...S.EXPORT_TABLES].sort());
  const r = rd("scripts/restore-backup.cjs"); assert.match(r, /name === "appointment_services"[\s\S]*ON CONFLICT \(code\) DO UPDATE/); assert.match(r, /"appointment_services"\]\.includes\(name\)/, "no serial sequence is reset for it");
  assert.match(rd("docs/SECRETARY.md"), /Accounts Receivable/);
});
