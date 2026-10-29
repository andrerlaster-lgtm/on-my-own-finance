import type { Account } from "./accounts";
import type { Ledger } from "./ledger";
import type { RateInfo, Trip } from "./mileage";
import { mileageLogDoc, mileageMonthlyDoc, mileageSummaryDoc } from "./mileageReports";
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
  { id: "mileage-summary", title: "Mileage Summary", blurb: "Business trips, miles and estimated deduction against the previous period. Not part of the ledger." },
  { id: "mileage-monthly", title: "Monthly Mileage Comparison", blurb: "Business miles and estimated deduction month by month for a year." },
  { id: "mileage-log", title: "Mileage Log", blurb: "Every trip with places, purpose, miles and whether the miles are estimated or actual." },
];
export const MILEAGE_REPORT_IDS = ["mileage-summary", "mileage-monthly", "mileage-log"];
export interface MileageData { trips: readonly Trip[]; rates: Record<number, RateInfo> }
export const REPORT_IDS = REPORTS.map((r) => r.id);

/** Builds one report from the URL-style parameters, so the screen, print view and Excel/PDF downloads always agree. */
export function buildReport(id: string, ledger: Ledger, accounts: readonly Account[], p: Record<string, string | undefined>, today: string, mileage?: MileageData): ReportDoc | null {
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
    case "mileage-summary": case "mileage-monthly": case "mileage-log": {
      if (!mileage) return { id, title: REPORTS.find((r) => r.id === id)!.title, subtitle: "", basis: "", columns: [], rows: [], notes: [], blocked: "The mileage log could not be read." };
      if (id === "mileage-summary") return mileageSummaryDoc(mileage.trips, mileage.rates, period);
      if (id === "mileage-monthly") return mileageMonthlyDoc(mileage.trips, mileage.rates, Number(period.range.from.slice(0, 4)));
      return mileageLogDoc(mileage.trips, period.range);
    }
    default: {
      const na = NOT_YET_AVAILABLE.find((x) => x.id === id);
      return na ? { id, title: na.title, subtitle: "", basis: "", columns: [], rows: [], notes: [], blocked: na.why } : null;
    }
  }
}
