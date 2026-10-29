import { TYPE_INFO, type Account } from "./accounts";
import { accountActivity, generalLedger, type Ledger, type Line } from "./ledger";
import { addDays, type Range } from "./dates";

/*
 * Financial statements, all calculated from the ledger lines (never from the source tables directly), so every report reconciles with the
 * General Ledger and Trial Balance. Cash basis. Pure: no network, no database.
 *
 * Layout of the income statement:   Revenue  ->  Cost of services  ->  Gross profit  ->  Operating expenses  ->  Operating income
 *                                   ->  Other income and expenses  ->  Net income.
 * Gross profit margin = gross profit / total revenue.   Net profit margin = net income / total revenue.   Tips are in Other income
 * (not Revenue) until your preparer decides how they are treated; processing fees are an operating expense.
 */
export const BASIS = "Cash basis";

export type PeriodKind = "month" | "quarter" | "year" | "custom";
export interface Period { kind: PeriodKind; range: Range; label: string; prev: { range: Range; label: string }; ytd: { range: Range; label: string } }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthRange = (y: number, m: number): Range => ({ from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` });
const quarterRange = (y: number, q: number): Range => ({ from: `${y}-${pad(q * 3 - 2)}-01`, to: `${y}-${pad(q * 3)}-${pad(lastDay(y, q * 3))}` });
export const monthName = (y: number, m: number) => `${MONTHS[m - 1]} ${y}`;
const isDate = (s: string | undefined): s is string => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "") && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const days = (r: Range) => Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000) + 1;

/** Reads ?period=month|quarter|year|custom with y, m, q, from, to. Anything invalid falls back to the current month. */
export function resolvePeriod(p: Record<string, string | undefined>, today: string): Period {
  const ty = Number(today.slice(0, 4)), tm = Number(today.slice(5, 7));
  const num = (s: string | undefined, lo: number, hi: number) => (/^\d{1,4}$/.test(s ?? "") && Number(s) >= lo && Number(s) <= hi ? Number(s) : null);
  const y = num(p.y, 2000, 2100) ?? ty;
  let kind: PeriodKind = p.period === "quarter" || p.period === "year" || p.period === "custom" ? p.period : "month";
  let range: Range, label: string, prev: { range: Range; label: string };
  if (kind === "custom" && isDate(p.from) && isDate(p.to) && p.from <= p.to && days({ from: p.from, to: p.to }) <= 3660) {
    range = { from: p.from, to: p.to };
    const n = days(range), pTo = addDays(p.from, -1), pFrom = addDays(pTo, -(n - 1));
    label = `${p.from} to ${p.to}`; prev = { range: { from: pFrom, to: pTo }, label: `${pFrom} to ${pTo}` };
  } else if (kind === "year") {
    range = { from: `${y}-01-01`, to: `${y}-12-31` }; label = String(y); prev = { range: { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }, label: String(y - 1) };
  } else if (kind === "quarter") {
    const q = num(p.q, 1, 4) ?? Math.ceil(tm / 3);
    range = quarterRange(y, q); label = `Q${q} ${y}`;
    const [py, pq] = q === 1 ? [y - 1, 4] : [y, q - 1];
    prev = { range: quarterRange(py, pq), label: `Q${pq} ${py}` };
  } else {
    kind = "month";
    const m = num(p.m, 1, 12) ?? tm;
    range = monthRange(y, m); label = monthName(y, m);
    const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
    prev = { range: monthRange(py, pm), label: monthName(py, pm) };
  }
  const endYear = range.to.slice(0, 4);
  return { kind, range, label, prev, ytd: { range: { from: `${endYear}-01-01`, to: range.to }, label: `Year to date (${endYear})` } };
}

/* ---------- amounts ---------- */

/** Amount of an account's activity in a range, on its normal side (so revenue and expenses both read as positive numbers). */
export function activityAmount(lines: readonly Line[], a: Account, range: Range): number {
  let d = 0, c = 0;
  for (const l of lines) if (l.accountId === a.id && l.date >= range.from && l.date <= range.to) { d += l.debit; c += l.credit; }
  return a.normal === "debit" ? d - c : c - d;
}

export interface Summary { revenue: number; cost: number; grossProfit: number; grossMargin: number | null; opex: number; operatingIncome: number; otherNet: number; netIncome: number; netMargin: number | null }
const pct = (n: number, d: number): number | null => (d === 0 ? null : (n / d) * 100);

export function summarize(lines: readonly Line[], accounts: readonly Account[], range: Range): Summary {
  const sum = (types: string[], pred?: (a: Account) => boolean) => accounts.filter((a) => types.includes(a.type) && (!pred || pred(a))).reduce((t, a) => t + activityAmount(lines, a, range), 0);
  const revenue = sum(["revenue"]), cost = sum(["cost_of_services"]), opex = sum(["operating_expense"]);
  const otherNet = sum(["other"], (a) => a.normal === "credit") - sum(["other"], (a) => a.normal === "debit");
  const grossProfit = revenue - cost, operatingIncome = grossProfit - opex, netIncome = operatingIncome + otherNet;
  return { revenue, cost, grossProfit, grossMargin: pct(grossProfit, revenue), opex, operatingIncome, otherNet, netIncome, netMargin: pct(netIncome, revenue) };
}

export const variance = (cur: number, prior: number): { amount: number; percent: number | null } => ({ amount: cur - prior, percent: prior === 0 ? null : ((cur - prior) / Math.abs(prior)) * 100 });

/* ---------- report documents: one shape rendered on screen, in print, and exported to Excel and PDF ---------- */

export interface Cell { text: string; amount?: number; /** miles in tenths */ miles?: number; percent?: number | null; href?: string; bold?: boolean }
export type RowKind = "section" | "line" | "subtotal" | "total" | "note" | "blank";
export interface DocRow { kind: RowKind; indent?: number; cells: Cell[] }
export interface DocColumn { label: string; align: "left" | "right" }
export interface ReportDoc { id: string; title: string; subtitle: string; basis: string; columns: DocColumn[]; rows: DocRow[]; notes: string[]; blocked?: string }

/** Statement style: 1,234.56 and (1,234.56) for negatives. */
export function fmtAmount(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  const body = `${Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${pad(abs % 100)}`;
  return cents < 0 && abs > 0 ? `(${body})` : body;
}
export const fmtPercent = (p: number | null): string => (p === null ? "n/a" : `${p < 0 ? "(" : ""}${Math.abs(p).toFixed(1)}%${p < 0 ? ")" : ""}`);

const amt = (cents: number, href?: string, bold?: boolean): Cell => ({ text: fmtAmount(cents), amount: cents, href, bold });
const pctCell = (p: number | null, bold?: boolean): Cell => ({ text: fmtPercent(p), percent: p, bold });
const txt = (text: string, bold?: boolean): Cell => ({ text, bold });

export const ledgerHref = (accountId: number, range: Range) => `/accounting/ledger?account=${accountId}&from=${range.from}&to=${range.to}`;

export interface StatementOptions { compare?: boolean; ytd?: boolean; showZero?: boolean }

/** Profit & Loss / Income Statement for a period, optionally beside the previous period (with variance) and year to date. */
export function incomeStatementDoc(ledger: Ledger, accounts: readonly Account[], period: Period, opt: StatementOptions = {}): ReportDoc {
  const cols: { label: string; range: Range }[] = [{ label: period.label, range: period.range }];
  if (opt.compare) cols.push({ label: period.prev.label, range: period.prev.range });
  if (opt.ytd) cols.push({ label: period.ytd.label, range: period.ytd.range });
  const columns: DocColumn[] = [{ label: "Account", align: "left" }, ...cols.map((c) => ({ label: c.label, align: "right" as const }))];
  if (opt.compare) columns.push({ label: "Variance $", align: "right" }, { label: "Variance %", align: "right" });
  const rows: DocRow[] = [];
  const pushVariance = (cells: Cell[], vals: number[], bold?: boolean) => {
    if (opt.compare) { const v = variance(vals[0], vals[1]); cells.push(amt(v.amount, undefined, bold), pctCell(v.percent, bold)); }
    return cells;
  };
  const section = (title: string) => rows.push({ kind: "section", cells: [txt(title, true)] });
  const accountRows = (types: string[], pred?: (a: Account) => boolean): number[] => {
    const totals = cols.map(() => 0);
    for (const a of accounts.filter((x) => types.includes(x.type) && (!pred || pred(x))).sort((x, y) => x.number - y.number)) {
      const vals = cols.map((c) => activityAmount(ledger.lines, a, c.range));
      if (!opt.showZero && vals.every((v) => v === 0)) continue;
      vals.forEach((v, i) => (totals[i] += v));
      rows.push({ kind: "line", indent: 1, cells: pushVariance([txt(`${a.number} ${a.label}`), ...vals.map((v, i) => amt(v, ledgerHref(a.id, cols[i].range)))], vals) });
    }
    return totals;
  };
  const total = (label: string, vals: number[], kind: RowKind = "subtotal") => rows.push({ kind, cells: pushVariance([txt(label, true), ...vals.map((v) => amt(v, undefined, true))], vals, true) });
  const margin = (label: string, num: number[], den: number[]) => rows.push({ kind: "line", indent: 1, cells: (() => { const c: Cell[] = [txt(label), ...num.map((n, i) => pctCell(pct(n, den[i])))]; if (opt.compare) c.push(txt(""), txt("")); return c; })() });

  section(TYPE_INFO.revenue.plural.toUpperCase());
  const rev = accountRows(["revenue"]);
  total("Total Revenue", rev);
  section("COST OF SERVICES");
  const cost = accountRows(["cost_of_services"]);
  total("Total Cost of Services", cost);
  const gp = rev.map((r, i) => r - cost[i]);
  total("GROSS PROFIT", gp, "total");
  margin("Gross profit margin", gp, rev);
  section("OPERATING EXPENSES");
  const opex = accountRows(["operating_expense"]);
  total("Total Operating Expenses", opex);
  const oi = gp.map((g, i) => g - opex[i]);
  total("OPERATING INCOME", oi, "total");
  section("OTHER INCOME AND EXPENSES");
  rows.push({ kind: "note", indent: 1, cells: [txt("Other income")] });
  const oinc = accountRows(["other"], (a) => a.normal === "credit");
  rows.push({ kind: "note", indent: 1, cells: [txt("Other expenses")] });
  const oexp = accountRows(["other"], (a) => a.normal === "debit");
  const onet = oinc.map((v, i) => v - oexp[i]);
  total("Net Other Income (Expense)", onet);
  const ni = oi.map((v, i) => v + onet[i]);
  total("NET INCOME", ni, "total");
  margin("Net profit margin", ni, rev);

  const notes = [
    "Cash basis: income is counted when received and expenses when paid. Inventory is costed as it is used.",
    "Tips are shown under Other income, not Revenue, until your tax preparer confirms their treatment.",
    "Square refund rows flagged at import are not recorded, so revenue can be higher than Square's net.",
    "Mileage is a tax estimate, not money spent, so it is not on this statement.",
  ];
  if (ledger.problems.length) notes.unshift(`NOT FINAL: ${ledger.problems.length} ledger problem(s) need attention (see Accounting Tools).`);
  return { id: "income-statement", title: "Profit & Loss (Income Statement)", subtitle: `${period.label}`, basis: BASIS, columns, rows, notes };
}

/** Cost of Services: direct costs against revenue, with gross profit and margin. */
export function costOfServicesDoc(ledger: Ledger, accounts: readonly Account[], period: Period, opt: StatementOptions = {}): ReportDoc {
  const cols: { label: string; range: Range }[] = [{ label: period.label, range: period.range }];
  if (opt.compare) cols.push({ label: period.prev.label, range: period.prev.range });
  const columns: DocColumn[] = [{ label: "Account", align: "left" }, ...cols.map((c) => ({ label: c.label, align: "right" as const }))];
  const rows: DocRow[] = [];
  const costTotals = cols.map(() => 0);
  rows.push({ kind: "section", cells: [txt("DIRECT COSTS OF PROVIDING SERVICES", true)] });
  for (const a of accounts.filter((x) => x.type === "cost_of_services").sort((x, y) => x.number - y.number)) {
    const vals = cols.map((c) => activityAmount(ledger.lines, a, c.range));
    if (!opt.showZero && vals.every((v) => v === 0)) continue;
    vals.forEach((v, i) => (costTotals[i] += v));
    rows.push({ kind: "line", indent: 1, cells: [txt(`${a.number} ${a.label}`), ...vals.map((v, i) => amt(v, ledgerHref(a.id, cols[i].range)))] });
  }
  rows.push({ kind: "subtotal", cells: [txt("Total Cost of Services", true), ...costTotals.map((v) => amt(v, undefined, true))] });
  const rev = cols.map((c) => accounts.filter((x) => x.type === "revenue").reduce((t, a) => t + activityAmount(ledger.lines, a, c.range), 0));
  rows.push({ kind: "blank", cells: [] });
  rows.push({ kind: "line", cells: [txt("Total Revenue"), ...rev.map((v) => amt(v))] });
  const gp = rev.map((r, i) => r - costTotals[i]);
  rows.push({ kind: "total", cells: [txt("GROSS PROFIT", true), ...gp.map((v) => amt(v, undefined, true))] });
  rows.push({ kind: "line", indent: 1, cells: [txt("Gross profit margin"), ...gp.map((v, i) => pctCell(pct(v, rev[i])))] });
  rows.push({ kind: "line", indent: 1, cells: [txt("Cost of services as % of revenue"), ...costTotals.map((v, i) => pctCell(pct(v, rev[i])))] });
  const notes = [
    "Cash basis. Supplies are costed when used (weighted average), so buying stock is an asset first and cost only when it is consumed.",
    "Collection kits, contractor labor and other direct costs appear here once expenses are classified to those accounts (Transactions page).",
  ];
  return { id: "cost-of-services", title: "Cost of Services", subtitle: period.label, basis: BASIS, columns, rows, notes };
}

/** Trial balance as of the end of the period: beginning balance, period debits and credits, ending balance. */
export function trialBalanceDoc(ledger: Ledger, accounts: readonly Account[], period: Period): ReportDoc {
  const act = accountActivity(ledger.lines, accounts, period.range).filter((x) => x.opening !== 0 || x.debits !== 0 || x.credits !== 0 || x.ending !== 0);
  const columns: DocColumn[] = [{ label: "Account", align: "left" }, { label: "Beginning balance", align: "right" }, { label: "Debits", align: "right" }, { label: "Credits", align: "right" }, { label: "Ending debit", align: "right" }, { label: "Ending credit", align: "right" }];
  const rows: DocRow[] = [];
  let td = 0, tc = 0, ed = 0, ec = 0;
  for (const type of ["asset", "liability", "equity", "revenue", "cost_of_services", "operating_expense", "other"] as const) {
    const group = act.filter((x) => x.account.type === type).sort((x, y) => x.account.number - y.account.number);
    if (!group.length) continue;
    rows.push({ kind: "section", cells: [txt(TYPE_INFO[type].plural.toUpperCase(), true)] });
    for (const x of group) {
      // an account's ending balance sits in the column of its normal side unless it has flipped
      const signed = x.account.normal === "debit" ? x.ending : -x.ending; // positive = debit balance
      const dr = signed > 0 ? signed : 0, cr = signed < 0 ? -signed : 0;
      td += x.debits; tc += x.credits; ed += dr; ec += cr;
      rows.push({ kind: "line", indent: 1, cells: [txt(`${x.account.number} ${x.account.label}`), amt(x.opening, ledgerHref(x.account.id, period.range)), amt(x.debits), amt(x.credits), amt(dr), amt(cr)] });
    }
  }
  rows.push({ kind: "total", cells: [txt("TOTALS", true), txt(""), amt(td, undefined, true), amt(tc, undefined, true), amt(ed, undefined, true), amt(ec, undefined, true)] });
  const notes = [
    ed === ec ? "Debits equal credits: the books are in balance." : "OUT OF BALANCE: ending debits and credits differ. Do not rely on these statements.",
    "Balances come only from recorded transactions. No opening bank or Square balances have been entered, so cash accounts are not bank balances.",
    "Beginning balance is the account's balance on its normal side before the period starts.",
  ];
  return { id: "trial-balance", title: "Trial Balance", subtitle: `As of ${period.range.to} (activity ${period.range.from} to ${period.range.to})`, basis: BASIS, columns, rows, notes };
}

/** General ledger for the chosen accounts: beginning balance, each transaction with a running balance, ending balance. */
export function generalLedgerDoc(ledger: Ledger, accounts: readonly Account[], range: Range, accountIds: readonly number[] | null): ReportDoc {
  const columns: DocColumn[] = [{ label: "Date", align: "left" }, { label: "Description", align: "left" }, { label: "Debit", align: "right" }, { label: "Credit", align: "right" }, { label: "Balance", align: "right" }];
  const rows: DocRow[] = [];
  const chosen = accounts.filter((a) => (accountIds === null || accountIds.includes(a.id))).sort((x, y) => x.number - y.number);
  for (const a of chosen) {
    const g = generalLedger(ledger, a, range);
    if (accountIds === null && g.rows.length === 0 && g.opening === 0) continue;
    rows.push({ kind: "section", cells: [txt(`${a.number} ${a.label}`, true)] });
    rows.push({ kind: "line", indent: 1, cells: [txt(""), txt("Beginning balance"), txt(""), txt(""), amt(g.opening)] });
    for (const r of g.rows) rows.push({ kind: "line", indent: 1, cells: [txt(r.line.date), { text: r.line.text, href: r.entry ? `/accounting/ledger/entry?key=${encodeURIComponent(r.entry.key)}` : undefined }, r.line.debit ? amt(r.line.debit) : txt(""), r.line.credit ? amt(r.line.credit) : txt(""), amt(r.balance)] });
    rows.push({ kind: "subtotal", cells: [txt(""), txt("Ending balance", true), amt(g.debits, undefined, true), amt(g.credits, undefined, true), amt(g.ending, undefined, true)] });
  }
  return { id: "general-ledger", title: "General Ledger", subtitle: `${range.from} to ${range.to}`, basis: BASIS, columns, rows, notes: ["Balances are shown on each account's normal side (debit for assets and expenses, credit for liabilities, equity and revenue).", "Beginning balances come only from recorded transactions."] };
}

/** One line per expense entry, grouped by the account it was classified to, with subtotals. Reconciles to the same accounts on the P&L. */
export function expenseDetailDoc(ledger: Ledger, accounts: readonly Account[], period: Period): ReportDoc {
  const columns: DocColumn[] = [{ label: "Date", align: "left" }, { label: "Description", align: "left" }, { label: "Amount", align: "right" }];
  const rows: DocRow[] = [];
  const byAccount = new Map<number, Line[]>();
  for (const e of ledger.entries) if (e.kind === "expense" && e.date >= period.range.from && e.date <= period.range.to) for (const l of e.lines) if (l.debit > 0) { const list = byAccount.get(l.accountId) ?? []; list.push(l); byAccount.set(l.accountId, list); }
  let grand = 0;
  for (const a of accounts.filter((x) => byAccount.has(x.id)).sort((x, y) => x.number - y.number)) {
    const list = byAccount.get(a.id)!;
    rows.push({ kind: "section", cells: [txt(`${a.number} ${a.label} (${TYPE_INFO[a.type].label.toLowerCase()})`, true)] });
    let sub = 0;
    for (const l of list) { sub += l.debit; rows.push({ kind: "line", indent: 1, cells: [txt(l.date), { text: l.text, href: `/accounting/ledger/entry?key=${encodeURIComponent(l.entryKey)}` }, amt(l.debit)] }); }
    grand += sub;
    rows.push({ kind: "subtotal", cells: [txt(""), txt(`Total ${a.label}`, true), amt(sub, undefined, true)] });
  }
  rows.push({ kind: "total", cells: [txt(""), txt("TOTAL EXPENSES", true), amt(grand, undefined, true)] });
  return { id: "expense-detail", title: "Expense Detail", subtitle: period.label, basis: BASIS, columns, rows, notes: ["Expense entries only. Supplies used from inventory and Square processing fees are not listed here; see Cost of Services and the General Ledger."] };
}

/** Revenue by revenue account (the service categories you set up), with each one's share. */
export function revenueByServiceDoc(ledger: Ledger, accounts: readonly Account[], period: Period): ReportDoc {
  const columns: DocColumn[] = [{ label: "Service / revenue account", align: "left" }, { label: "Entries", align: "right" }, { label: "Revenue", align: "right" }, { label: "% of revenue", align: "right" }];
  const rows: DocRow[] = [];
  const revAccounts = accounts.filter((a) => a.type === "revenue").sort((x, y) => x.number - y.number);
  const entryCount = (a: Account) => new Set(ledger.lines.filter((l) => l.accountId === a.id && l.date >= period.range.from && l.date <= period.range.to).map((l) => l.entryKey)).size;
  const totals = revAccounts.map((a) => activityAmount(ledger.lines, a, period.range));
  const total = totals.reduce((t, v) => t + v, 0);
  revAccounts.forEach((a, i) => { if (totals[i] !== 0) rows.push({ kind: "line", indent: 1, cells: [txt(`${a.number} ${a.label}`), { text: String(entryCount(a)), amount: entryCount(a) }, amt(totals[i], ledgerHref(a.id, period.range)), pctCell(pct(totals[i], total))] }); });
  rows.push({ kind: "total", cells: [txt("TOTAL REVENUE", true), txt(""), amt(total, undefined, true), pctCell(total === 0 ? null : 100, true)] });
  return { id: "revenue-by-service", title: "Revenue by Service", subtitle: period.label, basis: BASIS, columns, rows, notes: ["Every income entry is Service revenue until you choose a more specific revenue account for it (Transactions page, add revenue accounts under Chart of Accounts). Until then this report cannot split revenue by service."] };
}

/** Twelve months side by side. */
export function monthlyComparisonDoc(ledger: Ledger, accounts: readonly Account[], year: number): ReportDoc {
  const columns: DocColumn[] = [{ label: "Month", align: "left" }, { label: "Revenue", align: "right" }, { label: "Cost of services", align: "right" }, { label: "Gross profit", align: "right" }, { label: "GP margin", align: "right" }, { label: "Operating expenses", align: "right" }, { label: "Net income", align: "right" }, { label: "Net margin", align: "right" }];
  const rows: DocRow[] = [];
  const tot = { revenue: 0, cost: 0, grossProfit: 0, opex: 0, netIncome: 0 };
  for (let m = 1; m <= 12; m++) {
    const range = monthRange(year, m), s = summarize(ledger.lines, accounts, range);
    tot.revenue += s.revenue; tot.cost += s.cost; tot.grossProfit += s.grossProfit; tot.opex += s.opex; tot.netIncome += s.netIncome;
    rows.push({ kind: "line", cells: [txt(monthName(year, m)), amt(s.revenue), amt(s.cost), amt(s.grossProfit), pctCell(s.grossMargin), amt(s.opex), amt(s.netIncome), pctCell(s.netMargin)] });
  }
  rows.push({ kind: "total", cells: [txt(`TOTAL ${year}`, true), amt(tot.revenue, undefined, true), amt(tot.cost, undefined, true), amt(tot.grossProfit, undefined, true), pctCell(pct(tot.grossProfit, tot.revenue), true), amt(tot.opex, undefined, true), amt(tot.netIncome, undefined, true), pctCell(pct(tot.netIncome, tot.revenue), true)] });
  return { id: "monthly-comparison", title: "Monthly Profitability Comparison", subtitle: String(year), basis: BASIS, columns, rows, notes: ["Net income includes other income and expenses (such as tips)."] };
}

/** The headline numbers for a month: this month, the month before, the change, and the year to date. */
export function monthlyOverviewDoc(ledger: Ledger, accounts: readonly Account[], period: Period): ReportDoc {
  const cur = summarize(ledger.lines, accounts, period.range), prev = summarize(ledger.lines, accounts, period.prev.range), ytd = summarize(ledger.lines, accounts, period.ytd.range);
  const columns: DocColumn[] = [{ label: "", align: "left" }, { label: period.label, align: "right" }, { label: period.prev.label, align: "right" }, { label: "Variance $", align: "right" }, { label: "Variance %", align: "right" }, { label: period.ytd.label, align: "right" }];
  const rows: DocRow[] = [];
  const line = (label: string, key: keyof Summary, kind: RowKind = "line", isPct = false) => {
    const a = cur[key] as number | null, b = prev[key] as number | null, y = ytd[key] as number | null;
    if (isPct) { rows.push({ kind, cells: [txt(label), pctCell(a), pctCell(b), txt(""), txt(""), pctCell(y)] }); return; }
    const v = variance(a as number, b as number);
    rows.push({ kind, cells: [txt(label, kind !== "line"), amt(a as number, undefined, kind !== "line"), amt(b as number, undefined, kind !== "line"), amt(v.amount), pctCell(v.percent), amt(y as number, undefined, kind !== "line")] });
  };
  line("Total Revenue", "revenue"); line("Total Cost of Services", "cost"); line("Gross Profit", "grossProfit", "subtotal"); line("Gross Profit Margin", "grossMargin", "line", true);
  line("Total Operating Expenses", "opex"); line("Other income (expense), net", "otherNet"); line("Net Income", "netIncome", "total"); line("Net Profit Margin", "netMargin", "line", true);
  return { id: "monthly-overview", title: "Monthly Financial Overview", subtitle: period.label, basis: BASIS, columns, rows, notes: ["Compared with the previous month and year to date. Cash basis."] };
}

/** Statements that need records the app does not have yet. They are listed, not faked. */
export const NOT_YET_AVAILABLE: { id: string; title: string; why: string }[] = [
  { id: "balance-sheet", title: "Balance Sheet", why: "Needs opening balances for your bank account and Square balance, and bank statement reconciliation, so cash is a real number. Planned for the next phase (opening balances, then bank reconciliation)." },
  { id: "cash-flow", title: "Cash Flow Statement", why: "Needs the same opening cash balances and bank/Square payout records, so beginning and ending cash can be proven. Planned right after the Balance Sheet." },
];

/** Net income on the P&L must equal revenue + other income - all expenses in the trial balance. Used in tests and the integrity page. */
export function netIncomeFromActivity(ledger: Ledger, accounts: readonly Account[], range: Range): number {
  const act = accountActivity(ledger.lines, accounts, range);
  return act.filter((x) => x.account.type !== "asset" && x.account.type !== "liability" && x.account.type !== "equity").reduce((t, x) => t + (x.account.normal === "credit" ? x.credits - x.debits : -(x.debits - x.credits)), 0);
}
