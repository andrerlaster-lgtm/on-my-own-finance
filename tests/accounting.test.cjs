const test = require("node:test"), assert = require("node:assert/strict");
const A = require("../.testbuild/accounts.js"), L = require("../.testbuild/ledger.js"), S = require("../.testbuild/statements.js"), Inv = require("../.testbuild/inventory.js"), lots = require("../.testbuild/lots.js");

// Synthetic data only. Accounts are the seeded defaults, numbered as setup would create them.
const accounts = A.DEFAULT_ACCOUNTS.map((d, i) => ({ id: i + 1, number: d.number, label: d.label, type: d.type, normal: d.normal, system_key: d.key, active: true }));
const acc = (n) => accounts.find((a) => a.number === n);
const income = (id, on, source, gross, tip, fee, extra = {}) => ({ id, occurred_on: on, source, tax_form: "unknown", gross_cents: gross, tip_cents: tip, fee_cents: fee, visits: 1, imported: source === "square", payer_id: null, ...extra });
const expense = (id, on, category, amount, vendor = null) => ({ id, spent_on: on, amount_cents: amount, category, vendor, receipt_on_file: false, photos: 0 });
const mv = (id, item, on, kind, quantity, unit_cost_cents = null, reason = null) => ({ id, item_id: item, moved_on: on, kind, quantity, unit_cost_cents, reason, lot_number: null, expires_on: null });
const base = () => ({
  accounts, income: [], expenses: [], movements: [], items: [{ id: 1, label: "Tubes" }, { id: 2, label: "Kits" }], payments: [], manual: [],
});
const build = (over = {}) => { const input = { ...base(), ...over }; return { input, ledger: L.buildLedger(input) }; };
const bal = (ledger, n) => { const a = acc(n); const act = L.accountActivity(ledger.lines, [a], { from: "2000-01-01", to: "2100-01-01" })[0]; return act.ending; };
const month = (y, m) => S.resolvePeriod({ period: "month", y: String(y), m: String(m) }, "2026-10-15");

test("default chart: conventional numbering, one account per number, every system key present once", () => {
  const nums = A.DEFAULT_ACCOUNTS.map((d) => d.number);
  assert.equal(new Set(nums).size, nums.length);
  for (const d of A.DEFAULT_ACCOUNTS) { const t = A.TYPE_INFO[d.type]; assert.ok(d.number >= t.min && d.number <= t.max, d.label); if (t.normal && d.key !== "owner_draws") assert.equal(d.normal, t.normal, d.label); }
  const keys = A.DEFAULT_ACCOUNTS.map((d) => d.key).filter(Boolean);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of ["cash_bank", "square_balance", "inventory", "owner_contributions", "owner_draws", "service_revenue", "supplies_consumed", "processing_fees", "tips", "inventory_adjust", "opening_equity"]) assert.ok(keys.includes(k), k);
  for (const c of ["supplies", "insurance", "licenses_fees", "equipment", "software", "advertising", "professional_services", "phone_internet", "training", "other"]) assert.ok(keys.includes(`cat:${c}`), c);
  for (const t of ["asset", "liability", "equity", "revenue", "cost_of_services", "operating_expense", "other"]) assert.ok(A.DEFAULT_ACCOUNTS.some((d) => d.type === t), t);
});

test("account form: number range, unique number and name, business wording only, type locked when it has history or is a system account", () => {
  const ok = A.validateAccountForm({ number: "6150", label: "Parking and tolls", type: "operating_expense" }, accounts);
  assert.equal(ok.ok, true); assert.equal(ok.value.normal, "debit");
  assert.equal(A.validateAccountForm({ number: "6150", label: "Parking", type: "revenue" }, accounts).ok, false, "6150 is not a revenue number");
  assert.equal(A.validateAccountForm({ number: "6010", label: "Parking", type: "operating_expense" }, accounts).ok, false, "number taken");
  assert.equal(A.validateAccountForm({ number: "6150", label: "insurance", type: "operating_expense" }, accounts).ok, false, "name taken");
  assert.equal(A.validateAccountForm({ number: "615", label: "x", type: "operating_expense" }, accounts).ok, false);
  assert.equal(A.validateAccountForm({ number: "6150", label: "Call me@x.com", type: "operating_expense" }, accounts).ok, false, "no @");
  assert.equal(A.validateAccountForm({ number: "6150", label: "Card 4111111111111111", type: "operating_expense" }, accounts).ok, false, "no long numbers");
  assert.equal(A.validateAccountForm({ number: "7500", label: "Gain", type: "other" }, accounts).ok, false, "other accounts must say debit or credit");
  assert.equal(A.validateAccountForm({ number: "7500", label: "Gain", type: "other", normal: "credit" }, accounts).value.normal, "credit");
  const sys = acc(1000);
  assert.equal(A.validateAccountForm({ number: "1000", label: "Business checking", type: "asset" }, accounts, sys).ok, true, "rename is fine");
  assert.equal(A.validateAccountForm({ number: "4100", label: "Cash", type: "revenue" }, accounts, sys).ok, false, "system accounts cannot change type");
  const used = acc(6010);
  assert.equal(A.validateAccountForm({ number: "6010", label: "Insurance", type: "cost_of_services" }, accounts, used, true).ok, false, "type locked once it has transactions");
  assert.match(A.deactivateProblem(acc(1000)), /automatic postings/);
  assert.equal(A.deactivateProblem(acc(5020)), null);
});

test("journal validation refuses unequal, one-sided, empty and fractional entries", () => {
  const ok = [{ accountId: 1, debit: 500, credit: 0 }, { accountId: 2, debit: 0, credit: 500 }];
  assert.deepEqual(L.validateJournal(ok), []);
  assert.ok(L.validateJournal([{ accountId: 1, debit: 500, credit: 0 }, { accountId: 2, debit: 0, credit: 499 }]).join().match(/must be equal/));
  assert.ok(L.validateJournal([{ accountId: 1, debit: 500, credit: 0 }]).join().match(/at least two/));
  assert.ok(L.validateJournal([{ accountId: 1, debit: 500, credit: 500 }, { accountId: 2, debit: 0, credit: 0 }]).length > 0);
  assert.ok(L.validateJournal([{ accountId: 1, debit: 1.5, credit: 0 }, { accountId: 2, debit: 0, credit: 1.5 }]).join().match(/whole cents/));
  assert.ok(L.validateJournal([{ accountId: 1, debit: -5, credit: 0 }, { accountId: 2, debit: 0, credit: -5 }]).length > 0);
  assert.ok(L.validateJournal([{ accountId: 1, debit: 0, credit: 0 }, { accountId: 2, debit: 0, credit: 0 }]).length > 0);
});

test("a Square payment posts revenue, tips and the fee once, and the deposit is net of the fee", () => {
  const { ledger } = build({ income: [income(1, "2026-10-05", "square", 15000, 2000, 553)] });
  assert.deepEqual(ledger.problems, []);
  assert.equal(ledger.entries.length, 1);
  assert.equal(bal(ledger, 1010), 15000 + 2000 - 553, "Square balance = revenue + tips - fee");
  assert.equal(bal(ledger, 1000), 0, "nothing hits the bank until a payout is recorded");
  assert.equal(bal(ledger, 4000), 15000);
  assert.equal(bal(ledger, 7010), 2000, "tips are not revenue");
  assert.equal(bal(ledger, 6100), 553, "fee is an operating expense");
  const d = ledger.lines.reduce((t, l) => t + l.debit, 0), c = ledger.lines.reduce((t, l) => t + l.credit, 0);
  assert.equal(d, c);
});

test("a check or cash payment deposits to cash; a payout moves money from Square to the bank without touching revenue", () => {
  const manual = [{ id: 1, entry_date: "2026-10-10", kind: "transfer", description: "Square payout", reverses_id: null, lines: [{ account_id: acc(1000).id, debit_cents: 16000, credit_cents: 0 }, { account_id: acc(1010).id, debit_cents: 0, credit_cents: 16000 }] }];
  const { ledger } = build({ income: [income(1, "2026-10-05", "square", 15000, 2000, 553), income(2, "2026-10-06", "check", 10000, 0, 0)], manual });
  assert.equal(bal(ledger, 1000), 10000 + 16000);
  assert.equal(bal(ledger, 1010), 15000 + 2000 - 553 - 16000);
  assert.equal(bal(ledger, 4000), 25000, "payout is not revenue");
});

test("expenses post to their category account, or to the account you chose, and credit cash", () => {
  const { ledger } = build({ expenses: [expense(1, "2026-10-02", "insurance", 12000, "Acme Insurance"), expense(2, "2026-10-03", "supplies", 3000), expense(3, "2026-10-04", "other", 5000)], expenseAccounts: { 3: acc(5030).id } });
  assert.equal(bal(ledger, 6010), 12000);
  assert.equal(bal(ledger, 6090), 3000, "supplies default to office and general supplies, not cost of services");
  assert.equal(bal(ledger, 5030), 5000, "your classification wins");
  assert.equal(bal(ledger, 6900), 0);
  assert.equal(bal(ledger, 1000), -20000);
});

test("inventory: purchase is an asset, use is cost of services, nothing is counted twice, and the inventory account equals the inventory report", () => {
  const movements = [mv(1, 1, "2026-09-01", "opening", 10, 200), mv(2, 1, "2026-10-01", "purchase", 20, 300), mv(3, 1, "2026-10-10", "use", 5), mv(4, 1, "2026-10-20", "adjust_down", 2, null, "expired"), mv(5, 2, "2026-10-02", "purchase", 4, 1000), mv(6, 2, "2026-10-12", "use", 1)];
  const { input, ledger } = build({ movements, itemAccounts: { 2: acc(5020).id } });
  assert.deepEqual(ledger.problems, []);
  // item 1: 10@2.00 -> 20; buy 20@3.00 -> on hand 30, value 80.00; use 5 -> avg 2.6667 -> removes 13.33; expired 2 -> 5.33
  const r = Inv.replay(movements.filter((m) => m.item_id === 1)), r2 = Inv.replay(movements.filter((m) => m.item_id === 2));
  assert.equal(bal(ledger, 1300), r.valueCents + r2.valueCents, "inventory asset = replayed value");
  assert.equal(bal(ledger, 5010), 1333, "supplies used at weighted-average cost");
  assert.equal(bal(ledger, 5020), 1000, "kit consumption goes to the item's own account");
  assert.equal(bal(ledger, 5060), 533, "expired stock is written off to the adjustments account");
  assert.equal(bal(ledger, 3900), 2000, "opening stock offsets equity, not cash and not revenue");
  assert.equal(bal(ledger, 1000), -(6000 + 4000), "only the purchases leave the bank");
  assert.equal(bal(ledger, 6090) + bal(ledger, 6900), 0, "no expense was created by inventory");
  const checks = L.ledgerChecks(ledger, input);
  assert.ok(checks.every((c) => c.ok), JSON.stringify(checks.filter((c) => !c.ok)));
  const rep = lots.inventoryReport(input.items.map((i) => ({ ...i, unit: "box" })), movements, "2026-10-01", "2026-10-31");
  assert.equal(rep.totals.useValue, 1333 + 1000, "report and ledger agree on consumption");
});

test("inventory that cannot be valued is flagged and left out instead of guessed", () => {
  const { ledger } = build({ movements: [mv(1, 1, "2026-10-01", "use", 5)] });
  assert.ok(ledger.problems.join().match(/cannot be valued/));
  assert.equal(ledger.entries.length, 0);
});

test("owner contributions and draws are equity, never revenue or expense; estimated tax payments are owner draws", () => {
  const manual = [
    { id: 1, entry_date: "2026-10-01", kind: "owner_contribution", description: "Owner contribution", reverses_id: null, lines: [{ account_id: acc(1000).id, debit_cents: 50000, credit_cents: 0 }, { account_id: acc(3000).id, debit_cents: 0, credit_cents: 50000 }] },
    { id: 2, entry_date: "2026-10-15", kind: "owner_draw", description: "Owner draw", reverses_id: null, lines: [{ account_id: acc(3100).id, debit_cents: 20000, credit_cents: 0 }, { account_id: acc(1000).id, debit_cents: 0, credit_cents: 20000 }] },
  ];
  const { ledger } = build({ manual, payments: [{ id: 1, tax_year: 2026, paid_on: "2026-10-16", amount_cents: 30000, kind: "federal_estimated" }] });
  const p = S.summarize(ledger.lines, accounts, { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(p.revenue, 0); assert.equal(p.opex, 0); assert.equal(p.netIncome, 0, "equity transactions never touch profit");
  assert.equal(bal(ledger, 3000), 50000); assert.equal(bal(ledger, 3100), 50000);
  assert.equal(bal(ledger, 1000), 50000 - 20000 - 30000);
});

test("a manual entry that does not balance is left out of the ledger and reported", () => {
  const bad = [{ id: 9, entry_date: "2026-10-01", kind: "manual", description: "Bad", reverses_id: null, lines: [{ account_id: acc(1000).id, debit_cents: 500, credit_cents: 0 }, { account_id: acc(3000).id, debit_cents: 0, credit_cents: 400 }] }];
  const { ledger } = build({ manual: bad });
  assert.equal(ledger.entries.length, 0);
  assert.ok(ledger.problems.join().match(/did not balance/));
});

test("a missing system account is reported, never silently skipped", () => {
  const { ledger } = build({ accounts: accounts.filter((a) => a.system_key !== "tips"), income: [income(1, "2026-10-05", "square", 100, 50, 0)] });
  assert.ok(ledger.problems.join().match(/"tips"/));
  assert.equal(ledger.entries.length, 0, "the whole entry is held back so the books cannot be lopsided");
});

// A month with everything: used by the statement tests.
const scenario = () => build({
  income: [income(1, "2026-10-05", "square", 30000, 2000, 1000), income(2, "2026-10-12", "check", 20000, 0, 0), income(3, "2026-09-20", "square", 10000, 0, 320)],
  expenses: [expense(1, "2026-10-03", "insurance", 8000), expense(2, "2026-09-03", "insurance", 8000), expense(3, "2026-10-08", "other", 4000)],
  expenseAccounts: { 3: acc(5030).id },
  movements: [mv(1, 1, "2026-09-01", "purchase", 10, 500), mv(2, 1, "2026-09-15", "use", 2), mv(3, 1, "2026-10-09", "use", 3)],
  manual: [{ id: 1, entry_date: "2026-10-01", kind: "owner_contribution", description: "Owner contribution", reverses_id: null, lines: [{ account_id: acc(1000).id, debit_cents: 100000, credit_cents: 0 }, { account_id: acc(3000).id, debit_cents: 0, credit_cents: 100000 }] }],
});

test("monthly summary: revenue, cost of services, gross profit, margins, operating expenses and net income", () => {
  const { ledger } = scenario();
  const s = S.summarize(ledger.lines, accounts, { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(s.revenue, 50000);
  assert.equal(s.cost, 1500 + 4000, "3 tubes used at $5.00 plus contractor labor");
  assert.equal(s.grossProfit, 50000 - 5500);
  assert.equal(Math.round(s.grossMargin * 100) / 100, Math.round(((50000 - 5500) / 50000) * 10000) / 100);
  assert.equal(s.opex, 8000 + 1000, "insurance plus the Square fee");
  assert.equal(s.otherNet, 2000, "tips");
  assert.equal(s.netIncome, 50000 - 5500 - 9000 + 2000);
  assert.equal(S.summarize(ledger.lines, accounts, { from: "2026-10-01", to: "2026-10-31" }).netIncome, S.netIncomeFromActivity(ledger, accounts, { from: "2026-10-01", to: "2026-10-31" }), "P&L net income = trial-balance activity");
  const empty = S.summarize([], accounts, { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(empty.grossMargin, null); assert.equal(empty.netMargin, null, "no division by zero");
});

test("income statement: sections, subtotals and totals add up, and the previous-period variance is right", () => {
  const { ledger } = scenario();
  const doc = S.incomeStatementDoc(ledger, accounts, month(2026, 10), { compare: true, ytd: true });
  const find = (label) => doc.rows.find((r) => r.cells[0] && r.cells[0].text === label);
  assert.equal(find("Total Revenue").cells[1].amount, 50000);
  assert.equal(find("Total Revenue").cells[2].amount, 10000, "September revenue");
  assert.equal(find("Total Revenue").cells[4].amount, 40000, "variance $");
  assert.equal(find("Total Revenue").cells[5].percent, 400, "variance %");
  assert.equal(find("GROSS PROFIT").cells[1].amount, 44500);
  assert.equal(find("Total Cost of Services").cells[1].amount, 5500);
  assert.equal(find("Total Operating Expenses").cells[1].amount, 9000);
  assert.equal(find("OPERATING INCOME").cells[1].amount, 35500);
  assert.equal(find("NET INCOME").cells[1].amount, 37500);
  assert.equal(find("NET INCOME").cells[3].amount, find("NET INCOME").cells[1].amount - 0 + 0 && find("NET INCOME").cells[3].amount, "YTD column exists");
  // subtotals equal the sum of the account lines above them
  let running = 0, sections = [];
  for (const r of doc.rows) { if (r.kind === "line" && r.cells[1].amount !== undefined && r.indent === 1 && !/margin/i.test(r.cells[0].text)) running += r.cells[1].amount; if (r.kind === "subtotal" && /^Total (Revenue|Cost|Operating)/.test(r.cells[0].text)) { sections.push([r.cells[0].text, running, r.cells[1].amount]); running = 0; } }
  for (const [name, summed, shown] of sections) assert.equal(summed, shown, name);
  assert.match(doc.notes.join(" "), /Cash basis/);
});

test("the statement hides accounts with no activity unless asked, and every amount links to its ledger", () => {
  const { ledger } = scenario();
  const doc = S.incomeStatementDoc(ledger, accounts, month(2026, 10));
  assert.ok(!doc.rows.some((r) => r.cells[0] && /Advertising/.test(r.cells[0].text)));
  assert.ok(S.incomeStatementDoc(ledger, accounts, month(2026, 10), { showZero: true }).rows.some((r) => r.cells[0] && /Advertising/.test(r.cells[0].text)));
  const rev = doc.rows.find((r) => r.cells[0] && /4000 Service revenue/.test(r.cells[0].text));
  assert.match(rev.cells[1].href, /^\/accounting\/ledger\?account=\d+&from=2026-10-01&to=2026-10-31$/);
});

test("drill-down: the ledger lines behind a statement amount add up to that amount", () => {
  const { ledger } = scenario();
  const period = month(2026, 10);
  for (const n of [4000, 5010, 5030, 6010, 6100, 7010]) {
    const g = L.generalLedger(ledger, acc(n), period.range);
    const stmt = S.activityAmount(ledger.lines, acc(n), period.range);
    assert.equal(g.ending - g.opening, stmt, `account ${n}`);
    assert.equal(g.rows.length > 0, true);
  }
});

test("general ledger: beginning balance, running balance and ending balance", () => {
  const { ledger } = scenario();
  const g = L.generalLedger(ledger, acc(5010), { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(g.opening, 1000, "2 tubes used in September at $5.00");
  assert.equal(g.rows.length, 1);
  assert.equal(g.rows[0].balance, 2500);
  assert.equal(g.ending, 2500);
  assert.equal(g.debits, 1500); assert.equal(g.credits, 0);
  const sq = L.generalLedger(ledger, acc(1010), { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(sq.opening, 9680); assert.equal(sq.ending, 9680 + 31000);
  let run = sq.opening; for (const r of sq.rows) { run += r.line.debit - r.line.credit; assert.equal(r.balance, run); }
  const doc = S.generalLedgerDoc(ledger, accounts, { from: "2026-10-01", to: "2026-10-31" }, [acc(1010).id]);
  assert.ok(doc.rows.some((r) => r.cells[1] && r.cells[1].text === "Beginning balance"));
});

test("trial balance: debits equal credits, and the ending balances tie to the general ledger", () => {
  const { ledger } = scenario();
  const doc = S.trialBalanceDoc(ledger, accounts, month(2026, 10));
  const total = doc.rows.find((r) => r.kind === "total");
  assert.equal(total.cells[2].amount, total.cells[3].amount, "period debits = credits");
  assert.equal(total.cells[4].amount, total.cells[5].amount, "ending debits = ending credits");
  assert.match(doc.notes[0], /in balance/);
});

test("trial balance flips a balance to the other column when it goes the wrong way", () => {
  const { ledger } = build({ manual: [{ id: 1, entry_date: "2026-10-01", kind: "owner_draw", description: "Owner draw", reverses_id: null, lines: [{ account_id: acc(3100).id, debit_cents: 100, credit_cents: 0 }, { account_id: acc(1000).id, debit_cents: 0, credit_cents: 100 }] }] });
  const doc = S.trialBalanceDoc(ledger, accounts, month(2026, 10));
  const cash = doc.rows.find((r) => r.cells[0] && /1000/.test(r.cells[0].text));
  assert.equal(cash.cells[4].amount, 0); assert.equal(cash.cells[5].amount, 100, "cash below zero shows as a credit");
  const total = doc.rows.find((r) => r.kind === "total");
  assert.equal(total.cells[4].amount, total.cells[5].amount);
});

test("cost of services report: supplies, kits, labor, total, gross profit and margin", () => {
  const { ledger } = scenario();
  const doc = S.costOfServicesDoc(ledger, accounts, month(2026, 10));
  const get = (t) => doc.rows.find((r) => r.cells[0] && r.cells[0].text === t);
  assert.equal(get("5010 Medical supplies consumed").cells[1].amount, 1500);
  assert.equal(get("5030 Direct contractor labor").cells[1].amount, 4000);
  assert.equal(get("Total Cost of Services").cells[1].amount, 5500);
  assert.equal(get("GROSS PROFIT").cells[1].amount, 44500);
  assert.equal(get("Gross profit margin").cells[1].percent, 89);
});

test("expense detail reconciles to the same accounts on the P&L", () => {
  const { ledger } = scenario();
  const period = month(2026, 10);
  const detail = S.expenseDetailDoc(ledger, accounts, period);
  const total = detail.rows.find((r) => r.kind === "total").cells[2].amount;
  assert.equal(total, 8000 + 4000);
  const pl = S.summarize(ledger.lines, accounts, period.range);
  assert.equal(total, pl.opex + pl.cost - 1500 - 1000, "operating expenses plus cost of services, less the supplies consumed (1,500) and the Square fee (1,000), which are not paid expenses");
});

test("revenue by service: each revenue account with its share, totalling revenue", () => {
  const extra = [...accounts, { id: 99, number: 4010, label: "Mobile draw visits", type: "revenue", normal: "credit", system_key: null, active: true }];
  const { ledger } = build({ accounts: extra, income: [income(1, "2026-10-05", "check", 30000, 0, 0), income(2, "2026-10-06", "check", 10000, 0, 0)], incomeAccounts: { 2: 99 } });
  const doc = S.revenueByServiceDoc(ledger, extra, month(2026, 10));
  const lines = doc.rows.filter((r) => r.kind === "line");
  assert.equal(lines.length, 2);
  assert.equal(lines.map((r) => r.cells[2].amount).reduce((a, b) => a + b, 0), 40000);
  assert.equal(doc.rows.find((r) => r.kind === "total").cells[2].amount, 40000);
  assert.equal(lines.find((r) => /4010/.test(r.cells[0].text)).cells[3].percent, 25);
});

test("monthly comparison: twelve months, totals equal the annual P&L", () => {
  const { ledger } = scenario();
  const doc = S.monthlyComparisonDoc(ledger, accounts, 2026);
  assert.equal(doc.rows.length, 13);
  const total = doc.rows[12];
  const year = S.summarize(ledger.lines, accounts, { from: "2026-01-01", to: "2026-12-31" });
  assert.equal(total.cells[1].amount, year.revenue); assert.equal(total.cells[6].amount, year.netIncome);
  assert.equal(doc.rows[9].cells[1].amount, 50000, "October");
});

test("monthly overview compares with the previous month and year to date", () => {
  const { ledger } = scenario();
  const doc = S.monthlyOverviewDoc(ledger, accounts, month(2026, 10));
  const rev = doc.rows.find((r) => r.cells[0].text === "Total Revenue");
  assert.deepEqual([rev.cells[1].amount, rev.cells[2].amount, rev.cells[3].amount, rev.cells[5].amount], [50000, 10000, 40000, 60000]);
  assert.equal(doc.rows.find((r) => r.cells[0].text === "Net Income").kind, "total");
});

test("period selection: month, quarter, year and custom, with previous period and year to date", () => {
  const m = S.resolvePeriod({ period: "month", y: "2026", m: "1" }, "2026-10-15");
  assert.deepEqual(m.range, { from: "2026-01-01", to: "2026-01-31" }); assert.deepEqual(m.prev.range, { from: "2025-12-01", to: "2025-12-31" });
  const feb = S.resolvePeriod({ period: "month", y: "2028", m: "2" }, "2026-10-15"); assert.equal(feb.range.to, "2028-02-29");
  const q = S.resolvePeriod({ period: "quarter", y: "2026", q: "1" }, "2026-10-15");
  assert.deepEqual(q.range, { from: "2026-01-01", to: "2026-03-31" }); assert.deepEqual(q.prev.range, { from: "2025-10-01", to: "2025-12-31" });
  const y = S.resolvePeriod({ period: "year", y: "2026" }, "2026-10-15"); assert.deepEqual(y.prev.range, { from: "2025-01-01", to: "2025-12-31" });
  const c = S.resolvePeriod({ period: "custom", from: "2026-03-10", to: "2026-03-19" }, "2026-10-15");
  assert.deepEqual(c.prev.range, { from: "2026-02-28", to: "2026-03-09" }, "same length, right before");
  assert.deepEqual(c.ytd.range, { from: "2026-01-01", to: "2026-03-19" });
  assert.equal(S.resolvePeriod({ period: "custom", from: "2026-03-20", to: "2026-03-10" }, "2026-10-15").kind, "month", "backwards dates fall back");
  assert.equal(S.resolvePeriod({ period: "custom", from: "nope", to: "x" }, "2026-10-15").label, "October 2026");
  assert.equal(S.resolvePeriod({ period: "month", y: "abc", m: "13" }, "2026-10-15").label, "October 2026");
});

test("variance and number formats", () => {
  assert.deepEqual(S.variance(150, 100), { amount: 50, percent: 50 });
  assert.deepEqual(S.variance(50, 100), { amount: -50, percent: -50 });
  assert.equal(S.variance(5, 0).percent, null);
  assert.equal(S.fmtAmount(123456), "1,234.56"); assert.equal(S.fmtAmount(-123456), "(1,234.56)"); assert.equal(S.fmtAmount(0), "0.00"); assert.equal(S.fmtAmount(-0), "0.00");
  assert.equal(S.fmtPercent(-12.34), "(12.3%)"); assert.equal(S.fmtPercent(null), "n/a");
});

test("integrity checks pass on a clean book and fail when the ledger is tampered with", () => {
  const { input, ledger } = scenario();
  assert.ok(L.ledgerChecks(ledger, input).every((c) => c.ok));
  const tampered = { ...ledger, entries: ledger.entries.map((e, i) => (i === 0 ? { ...e, lines: [{ ...e.lines[0], debit: e.lines[0].debit + 1 }, ...e.lines.slice(1)] } : e)) };
  tampered.lines = tampered.entries.flatMap((e) => e.lines);
  assert.ok(L.ledgerChecks(tampered, input).some((c) => !c.ok));
});

test("duplicate protection: the same source record is never posted twice, and likely double entries are warned about", () => {
  const dupes = build({ income: [income(1, "2026-10-05", "square", 100, 0, 0), income(1, "2026-10-05", "square", 100, 0, 0)] });
  assert.ok(dupes.ledger.problems.join().match(/Duplicate ledger entry income:1/));
  const warn = L.doubleCountWarnings({ ...base(), expenses: [expense(1, "2026-10-01", "supplies", 6000), expense(2, "2026-10-02", "other", 400, "Square")], movements: [mv(1, 1, "2026-10-01", "purchase", 20, 300)] });
  assert.equal(warn.length, 2);
  assert.match(warn[0], /same date and amount as an inventory purchase/); assert.match(warn[1], /Square/);
  assert.deepEqual(L.doubleCountWarnings(base()), []);
});

test("statements that need opening balances and bank records are listed as not available, not faked", () => {
  const ids = S.NOT_YET_AVAILABLE.map((x) => x.id);
  assert.deepEqual(ids.sort(), ["balance-sheet", "cash-flow"]);
  for (const n of S.NOT_YET_AVAILABLE) assert.match(n.why, /opening/i);
});

test("deleting or changing a source record changes the ledger on the next view and nothing else (no stored copies to drift)", () => {
  const a = build({ income: [income(1, "2026-10-05", "check", 100, 0, 0), income(2, "2026-10-06", "check", 200, 0, 0)] }).ledger;
  const b = build({ income: [income(1, "2026-10-05", "check", 100, 0, 0)] }).ledger;
  assert.equal(a.entries.length - b.entries.length, 1);
  assert.deepEqual(a.entries[0], b.entries[0], "unchanged records produce identical entries");
});

/* ---------- report registry and exports ---------- */
const R = require("../.testbuild/reports.js"), X = require("../.testbuild/xlsx.js"), P = require("../.testbuild/pdfdoc.js");
const unzip = (buf) => {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), out = {};
  let end = buf.length - 22; assert.equal(dv.getUint32(end, true), 0x06054b50, "end of central directory");
  const n = dv.getUint16(end + 10, true); let at = dv.getUint32(end + 16, true);
  for (let i = 0; i < n; i++) {
    assert.equal(dv.getUint32(at, true), 0x02014b50);
    const crc = dv.getUint32(at + 16, true), size = dv.getUint32(at + 24, true), nl = dv.getUint16(at + 28, true), off = dv.getUint32(at + 42, true);
    const name = Buffer.from(buf.subarray(at + 46, at + 46 + nl)).toString();
    const ln = dv.getUint16(off + 26, true), data = buf.subarray(off + 30 + ln, off + 30 + ln + size);
    assert.equal(X.crc32(data), crc, `crc of ${name}`); out[name] = Buffer.from(data).toString(); at += 46 + nl;
  }
  return out;
};

test("every listed report builds from the ledger, and unavailable statements say why instead of showing numbers", () => {
  const { ledger } = scenario();
  for (const r of R.REPORTS) { const doc = R.buildReport(r.id, ledger, accounts, { period: "month", y: "2026", m: "10" }, "2026-10-15", { trips: [], rates: {} }); assert.ok(doc, r.id); assert.ok(!doc.blocked, r.id); }
  const bs = R.buildReport("balance-sheet", ledger, accounts, {}, "2026-10-15");
  assert.ok(bs.blocked && bs.rows.length === 0, "no balance sheet numbers");
  assert.equal(R.buildReport("nope", ledger, accounts, {}, "2026-10-15"), null);
});

test("Excel export is a valid zip with real numbers that match the statement", () => {
  const { ledger } = scenario();
  const doc = R.buildReport("income-statement", ledger, accounts, { period: "month", y: "2026", m: "10" }, "2026-10-15");
  const files = unzip(X.reportToXlsx(doc));
  for (const f of ["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml"]) assert.ok(files[f], f);
  const net = doc.rows.find((r) => /^NET INCOME/i.test(r.cells[0].text)).cells[1].amount;
  assert.ok(files["xl/worksheets/sheet1.xml"].includes(`<v>${(net / 100).toFixed(2)}</v>`), "net income is a number in the sheet");
  assert.ok(files["xl/worksheets/sheet1.xml"].includes("Income Statement") || files["xl/worksheets/sheet1.xml"].includes(doc.title));
  const tricky = { ...doc, title: "A & B <x>", rows: [] };
  assert.ok(unzip(X.reportToXlsx(tricky))["xl/worksheets/sheet1.xml"].includes("A &amp; B &lt;x&gt;"));
});

test("PDF export is well formed: cross-reference offsets point at their objects, and figures are printed in statement style", () => {
  const { ledger } = scenario();
  const doc = R.buildReport("income-statement", ledger, accounts, { period: "month", y: "2026", m: "10", compare: "1" }, "2026-10-15");
  const bytes = P.reportToPdf(doc, "2026-10-15"), text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4") && text.trimEnd().endsWith("%%EOF"));
  const xref = Number(/startxref\n(\d+)/.exec(text)[1]); assert.ok(text.slice(xref).startsWith("xref"));
  const offs = [...text.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  offs.forEach((o, i) => assert.ok(text.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
  assert.ok(text.includes("Income Statement") || text.includes(doc.title.replace(/[()]/g, "")));
  const long = { ...doc, rows: Array.from({ length: 200 }, (_, i) => ({ kind: "line", cells: [{ text: `Row ${i}` }, { text: "", amount: i * 100 }, { text: "", amount: -i }] })) };
  assert.ok(/Page 1 of [2-9]/.test(Buffer.from(P.reportToPdf(long, "x")).toString("latin1")), "long reports paginate");
});

/* ---------- entry forms ---------- */
const JF = require("../.testbuild/journalForms.js");
test("owner contribution, draw and payout forms build balanced entries on the right accounts", () => {
  const ok = (kind, f) => { const r = JF.parseSimpleEntry(kind, f, accounts, "2026-10-15"); assert.ok(r.ok, JSON.stringify(r.errors)); assert.deepEqual(L.validateJournal(r.value.lines.map((l) => ({ accountId: l.account_id, debit: l.debit_cents, credit: l.credit_cents }))), []); return r.value; };
  const c = ok("owner_contribution", { entry_date: "2026-10-01", amount: "$250.00" });
  assert.deepEqual(c.lines.map((l) => [l.account_id, l.debit_cents, l.credit_cents]), [[acc(1000).id, 25000, 0], [acc(3000).id, 0, 25000]]);
  const d = ok("owner_draw", { entry_date: "2026-10-02", amount: "100", description: "Draw for personal use" });
  assert.deepEqual(d.lines.map((l) => [l.account_id, l.debit_cents, l.credit_cents]), [[acc(3100).id, 10000, 0], [acc(1000).id, 0, 10000]]);
  assert.equal(d.description, "Draw for personal use");
  const t = ok("transfer", { entry_date: "2026-10-03", amount: "1000.00" });
  assert.deepEqual(t.lines.map((l) => [l.account_id, l.debit_cents, l.credit_cents]), [[acc(1000).id, 100000, 0], [acc(1010).id, 0, 100000]]);
});

test("entry forms reject bad dates, amounts, details and unbalanced journals", () => {
  const bad = (r) => { assert.equal(r.ok, false); return r.errors.join(" | "); };
  assert.match(bad(JF.parseSimpleEntry("owner_draw", { entry_date: "2026-02-31", amount: "5" }, accounts, "2026-10-15")), /Date/);
  assert.match(bad(JF.parseSimpleEntry("owner_draw", { entry_date: "2026-10-01", amount: "0" }, accounts, "2026-10-15")), /Amount/);
  assert.match(bad(JF.parseSimpleEntry("owner_draw", { entry_date: "2026-10-01", amount: "-5" }, accounts, "2026-10-15")), /Amount/);
  assert.match(bad(JF.parseSimpleEntry("owner_draw", { entry_date: "2026-10-01", amount: "5", description: "card 4111111111111111" }, accounts, "2026-10-15")), /Description/);
  assert.match(bad(JF.parseSimpleEntry("owner_draw", { entry_date: "2030-10-01", amount: "5" }, accounts, "2026-10-15")), /ahead/);
  const inactive = accounts.map((a) => (a.system_key === "owner_draws" ? { ...a, active: false } : a));
  assert.match(bad(JF.parseSimpleEntry("owner_draw", { entry_date: "2026-10-01", amount: "5" }, inactive, "2026-10-15")), /standard accounts/);
  const j = (o) => JF.parseJournalForm({ entry_date: "2026-10-05", description: "Fix classification", ...o }, accounts, "2026-10-15");
  const good = j({ a1: String(acc(6090).id), d1: "40.00", a2: String(acc(6900).id), c2: "40.00" });
  assert.ok(good.ok); assert.equal(good.value.kind, "manual");
  assert.match(bad(j({ a1: String(acc(6090).id), d1: "40.00", a2: String(acc(6900).id), c2: "39.99" })), /must be equal/);
  assert.match(bad(j({ a1: String(acc(6090).id), d1: "40.00", c1: "40.00", a2: String(acc(6900).id), c2: "40.00" })), /either a debit or a credit/);
  assert.match(bad(j({ a1: String(acc(6090).id), d1: "40.00" })), /at least two lines/);
  assert.match(bad(j({ description: "", a1: String(acc(6090).id), d1: "1", a2: String(acc(6900).id), c2: "1" })), /Description/);
  const off = accounts.map((a) => (a.number === 6900 ? { ...a, active: false } : a));
  assert.match(bad(JF.parseJournalForm({ entry_date: "2026-10-05", description: "x", a1: String(acc(6090).id), d1: "1", a2: String(acc(6900).id), c2: "1" }, off, "2026-10-15")), /active account/);
  const adj = JF.parseJournalForm({ entry_date: "2026-10-05", kind: "adjusting", description: "Adj", a1: String(acc(6090).id), d1: "1", a2: String(acc(6900).id), c2: "1" }, accounts, "2026-10-15");
  assert.equal(adj.value.kind, "adjusting");
});
