import type { Account } from "./accounts";
import type { Ledger } from "./ledger";
import { costOfServicesDoc, expenseDetailDoc, generalLedgerDoc, incomeStatementDoc, monthlyComparisonDoc, monthlyOverviewDoc, NOT_YET_AVAILABLE, resolvePeriod, revenueByServiceDoc, trialBalanceDoc, type ReportDoc } from "./statements";

export const REPORTS: { id: string; title: string; blurb: string }[] = [
  { id: "income-statement", title: "Profit & Loss (Income Statement)", blurb: "Revenue, cost of services, gross profit, operating expenses and net income." },
  { id: "cost-of-services", title: "Cost of Services", blurb: "Direct costs of delivering your service and the gross profit left after them." },
  { id: "general-ledger", title: "General Ledger", blurb: "Every account with beginning balance, transactions, running balance and ending balance." },
  { id: "trial-balance", title: "Trial Balance", blurb: "Every account's balance; total debits must equal total credits." },
  { id: "expense-detail", title: "Expense Detail", blurb: "Each paid expense by account, with the same totals as the P&L." },
  { id: "revenue-by-service", title: "Revenue by Service", blurb: "Revenue by account, with each one's share of the total." },
  { id: "monthly-comparison", title: "Monthly Profitability Comparison", blurb: "Twelve months side by side for a year." },
  { id: "monthly-overview", title: "Monthly Financial Overview", blurb: "The month at a glance against last month and the year to date." },
];
export const REPORT_IDS = REPORTS.map((r) => r.id);

/** Builds one report from the URL-style parameters, so the screen, print view and Excel/PDF downloads always agree. */
export function buildReport(id: string, ledger: Ledger, accounts: readonly Account[], p: Record<string, string | undefined>, today: string): ReportDoc | null {
  const period = resolvePeriod(p, today);
  const flag = (k: string) => p[k] === "1";
  switch (id) {
    case "income-statement": return incomeStatementDoc(ledger, accounts, period, { compare: flag("compare"), ytd: flag("ytd"), showZero: flag("zero") });
    case "cost-of-services": return costOfServicesDoc(ledger, accounts, period, { compare: flag("compare"), ytd: flag("ytd") });
    case "trial-balance": return trialBalanceDoc(ledger, accounts, period);
    case "general-ledger": { const acct = /^\d+$/.test(p.account ?? "") ? [Number(p.account)] : null; return generalLedgerDoc(ledger, accounts, period.range, acct); }
    case "expense-detail": return expenseDetailDoc(ledger, accounts, period);
    case "revenue-by-service": return revenueByServiceDoc(ledger, accounts, period);
    case "monthly-comparison": return monthlyComparisonDoc(ledger, accounts, Number(period.range.from.slice(0, 4)));
    case "monthly-overview": return monthlyOverviewDoc(ledger, accounts, period);
    default: {
      const na = NOT_YET_AVAILABLE.find((x) => x.id === id);
      return na ? { id, title: na.title, subtitle: "", basis: "", columns: [], rows: [], notes: [], blocked: na.why } : null;
    }
  }
}
