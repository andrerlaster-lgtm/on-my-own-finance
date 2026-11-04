const test = require("node:test"), assert = require("node:assert/strict");
const T = require("../.testbuild/taxforms.js"), P = require("../.testbuild/packet.js"), R = require("../.testbuild/taxRules.js"), S = require("../.testbuild/schema.js"), V = require("../.testbuild/inventory.js"), L = require("../.testbuild/lots.js");

let n = 0;
const inc = (o) => ({ id: ++n, occurred_on: "2026-03-10", source: "square", tax_form: "1099k", gross_cents: 10000, tip_cents: 1000, fee_cents: 300, visits: 1, imported: true, payer_id: null, ...o });
const payers = [{ id: 7, label: "City Lab" }, { id: 8, label: "Clinic Co" }];

test("forms, payers and payments: strict parsing, no personal identifiers", () => {
  assert.equal(T.parsePayerForm({ label: "City Lab" }).ok, true);
  for (const bad of ["", "123-45-6789", "a@b.com", "Tax ID 123456789", "x".repeat(61)]) assert.equal(T.parsePayerForm({ label: bad }).ok, false, bad);
  const f = (o) => T.parseFormEntry({ tax_year: "2026", form_type: "1099nec", payer_id: "7", amount: "12500.00", ...o });
  assert.deepEqual(f({}).value, { tax_year: 2026, form_type: "1099nec", payer_id: 7, amount_cents: 1250000 });
  assert.equal(f({ payer_id: "" }).ok, false, "a 1099-NEC needs its payer"); assert.equal(f({ form_type: "1099k", payer_id: "" }).ok, true, "a 1099-K may be from the processor with no payer");
  assert.equal(f({ amount: "-1" }).ok, false); assert.equal(f({ tax_year: "1999" }).ok, false); assert.equal(f({ form_type: "w2" }).ok, false);
  const p = (o) => T.parsePaymentForm({ tax_year: "2026", paid_on: "2027-01-15", amount: "500", kind: "federal_estimated", ...o });
  assert.equal(p({}).ok, true); assert.equal(p({ amount: "0" }).ok, false); assert.equal(p({ kind: "gift" }).ok, false); assert.equal(p({ paid_on: "2027-02-30" }).ok, false);
});

test("reconciliation: form vs app receipts (revenue + tips, before fees), by form and payer; differences shown, missing forms listed", () => {
  const entries = [inc({}), inc({ gross_cents: 5000, tip_cents: 0 }), inc({ tax_form: "1099nec", source: "check", payer_id: 7, gross_cents: 200000, tip_cents: 0 }),
    inc({ tax_form: "1099nec", source: "check", payer_id: 8, gross_cents: 30000, tip_cents: 0 }), inc({ tax_form: "unknown" }), inc({ occurred_on: "2025-12-31", gross_cents: 999999 })];
  const forms = [{ id: 1, tax_year: 2026, form_type: "1099k", payer_id: null, amount_cents: 16000 }, { id: 2, tax_year: 2026, form_type: "1099nec", payer_id: 7, amount_cents: 210000 }];
  const r = T.reconcile(entries, forms, payers, 2026);
  assert.deepEqual(r.rows.map((x) => [x.form_type, x.payer_label, x.formCents, x.appCents, x.diff, x.status]), [["1099k", null, 16000, 16000, 0, "match"], ["1099nec", "City Lab", 210000, 200000, 10000, "form_higher"]]);
  assert.deepEqual(r.unformed, [{ form_type: "1099nec", payer_label: "Clinic Co", appCents: 30000 }], "receipts with no form entered; 'unknown' and other years are ignored");
});

test("threshold progress only counts once set and confirmed", () => {
  assert.equal(T.thresholdProgress(100, null, false).status, "unset"); assert.equal(T.thresholdProgress(100, 600, false).status, "unconfirmed");
  assert.equal(T.thresholdProgress(59999, 600, true).status, "below"); assert.equal(T.thresholdProgress(60000, 600, true).status, "reached");
});

test("set-aside: percent x estimated profit, only when the percent is set and confirmed and a profit estimate exists", () => {
  const rules = (o) => ({ set_aside_percent: 25, set_aside_confirmed: true, ...o });
  assert.deepEqual(T.setAside(100000, rules({}), 20000), { status: "ok", amountCents: 25000, paidCents: 20000, remainingCents: 5000 });
  assert.equal(T.setAside(100000, rules({ set_aside_percent: null }), 0).status, "percent_not_set");
  assert.equal(T.setAside(100000, rules({ set_aside_confirmed: false }), 0).status, "percent_not_confirmed");
  assert.equal(T.setAside(null, rules({}), 0).status, "no_profit_estimate");
  assert.equal(T.setAside(-5000, rules({}), 0).amountCents, 0, "a loss sets nothing aside");
  assert.equal(T.setAside(100001, rules({ set_aside_percent: 33.33 }), 0).amountCents, 33330);
});

function packet(over = {}) {
  const rules = { ...R.emptyRules(2026), mileage_rate_cents: 70, mileage_rate_confirmed: true, set_aside_percent: 20, set_aside_confirmed: true, sales_tax: "not_applicable", sales_tax_confirmed: true,
    threshold_1099k_dollars: 600, threshold_1099k_confirmed: true, threshold_1099nec_dollars: 600, threshold_1099nec_confirmed: true };
  const income = [inc({ gross_cents: 10000, tip_cents: 1500, fee_cents: 350 }), inc({ gross_cents: 20000, tip_cents: 0, fee_cents: 0, source: "check", tax_form: "1099nec", payer_id: 7, imported: false, visits: 4 }), inc({ gross_cents: 5000, tip_cents: 0, fee_cents: 150, tax_form: "unknown" })];
  const expenses = [{ id: 1, spent_on: "2026-04-01", amount_cents: 2500, category: "supplies", vendor: "Office Depot", receipt_on_file: true, photos: 0 }, { id: 2, spent_on: "2026-05-01", amount_cents: 1000, category: "insurance", vendor: null, receipt_on_file: false, photos: 0 }];
  const trips = [{ id: 1, driven_on: "2026-04-02", miles_tenths: 100, purpose: "lab_dropoff", odometer_start: null, odometer_end: null }];
  const inventory = L.inventoryReport([], [], "2026-01-01", "2026-12-31");
  return P.buildPacket({ year: 2026, income, expenses, trips, rules, forms: [], payers, payments: [{ id: 1, tax_year: 2026, paid_on: "2026-06-15", amount_cents: 1000, kind: "federal_estimated" }], inventory, expiredLots: 0, lastImportRefunds: 0, ...over });
}

test("packet: every grouping adds up to the same total, with tips separate and nothing counted twice", () => {
  const k = packet();
  const t = k.receipts.total;
  assert.deepEqual([t.revenue, t.tips, t.receipts, t.fees], [35000, 1500, 36500, 500]);
  for (const g of [k.receipts.bySource, k.receipts.byForm, k.receipts.byPayer]) assert.equal(g.reduce((s, x) => s + x.receipts, 0), t.receipts);
  assert.equal(k.profit.netAfterFees, 36000); assert.equal(k.profit.estimatedProfit, 36000 - 3500);
  assert.deepEqual(k.expenses.byCategory.map((c) => [c.key, c.total, c.withReceipt, c.without]), [["supplies", 2500, 1, 0], ["insurance", 1000, 0, 1]]);
  assert.deepEqual([k.mileage.miles_tenths, k.mileage.deductionCents], [100, 700]);
  assert.equal(k.setAside.amountCents, Math.round(32500 * 0.2)); assert.equal(k.setAside.remainingCents, 6500 - 1000);
});

test("packet: estimated profit and set-aside need expenses; unconfirmed rules are listed", () => {
  const k = packet({ expenses: [] });
  assert.equal(k.profit.estimatedProfit, null); assert.equal(k.setAside.status, "no_profit_estimate");
  assert.ok(k.readiness.some((r) => /No expenses are entered/.test(r.text)));
  const bare = P.buildPacket({ year: 2026, income: [], expenses: [], trips: [], rules: R.emptyRules(2026), forms: [], payers: [], payments: [], inventory: L.inventoryReport([], [], "2026-01-01", "2026-12-31"), expiredLots: 0, lastImportRefunds: 0 });
  assert.equal(bare.readiness.filter((r) => r.level === "attention" && /^Tax rule:/.test(r.text)).length, 5, "nothing is assumed: all five rules need the preparer");
  assert.equal(bare.mileage.deductionCents, null);
});

test("packet readiness: the things that need attention before sending", () => {
  const k = packet({ expiredLots: 2, lastImportRefunds: 3, forms: [{ id: 1, tax_year: 2026, form_type: "1099k", payer_id: null, amount_cents: 99999 }] });
  const text = k.readiness.filter((r) => r.level === "attention").map((r) => r.text).join("\n");
  assert.match(text, /1 income entry has no tax form chosen/); assert.match(text, /1 expense has no receipt kept or photo/);
  assert.match(text, /2 inventory lots are expired/); assert.match(text, /flagged 3 refund rows/); assert.match(text, /1099-K: form shows 999\.99 but the app has 115\.00/);
  assert.match(text, /1099-NEC from City Lab: the app has receipts but no form amount/);
  const sales = packet({ rules: { ...R.emptyRules(2026), sales_tax: "applicable" } });
  assert.ok(sales.readiness.some((r) => /does not track or calculate sales tax/.test(r.text)));
});

test("CSV sections: whole-cent numbers, formula guard, and no ids or personal fields", () => {
  const k = packet();
  const csv = (s) => P.packetCsv(k, s).trim().split("\r\n");
  assert.deepEqual(P.PACKET_SECTIONS.length, 8);
  assert.equal(csv("receipts").at(-1), "all,Total,3,35000,1500,36500,500,6");
  assert.match(csv("summary").join("\n"), /revenue_cents \(excludes tips and refunds\),35000/); assert.match(csv("summary").join("\n"), /sales_tax_status,not_applicable/);
  assert.equal(csv("expenses_detail")[0], "date,category,vendor,amount_cents,receipt_kept,photos");
  const evil = packet({ expenses: [{ id: 9, spent_on: "2026-04-01", amount_cents: 100, category: "other", vendor: "=HYPERLINK(x)", receipt_on_file: false, photos: 0 }] });
  assert.match(P.packetCsv(evil, "expenses_detail"), /'=HYPERLINK/, "spreadsheet formulas are neutralised");
  for (const s of P.PACKET_SECTIONS) assert.doesNotMatch(P.packetCsv(k, s), /\bpayer_id\b|\bincome_id\b|ssn|ein/i, s);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(k)), "a packet is plain JSON, safe to store as a snapshot");
});

test("schema v5: additive, no tax-id or contact columns, new tables exported", () => {
  const sql = S.schemaStatements.join("\n");
  assert.ok(S.SCHEMA_VERSION >= 5);
  for (const t of ["payers", "income_entry_payers", "form_1099_entries", "tax_payments", "tax_snapshots"]) assert.ok(S.EXPORT_TABLES.includes(t), t);
  assert.doesNotMatch(sql, /\b(ein|ssn|tin|tax_id|taxpayer|address|phone|email)\b/i);
  assert.match(sql, /CHECK \(form_type = '1099k' OR payer_id IS NOT NULL\)/);
});
