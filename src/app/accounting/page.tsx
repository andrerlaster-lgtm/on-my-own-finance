import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadBooks, flatParams } from "@/lib/accountingPage";
import { doubleCountWarnings, ledgerChecks } from "@/lib/ledger";
import { fmtAmount, fmtPercent, resolvePeriod, summarize, variance } from "@/lib/statements";
import { buildReport } from "@/lib/reports";
import { todayInChicago } from "@/lib/dates";
import { PeriodForm } from "@/components/accounting/PeriodForm";
import { ReportView } from "@/components/accounting/ReportView";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = flatParams(await searchParams), today = todayInChicago();
  await requireOwner();
  const { input, accounts, ledger } = await loadBooks();
  const period = resolvePeriod(p, today);
  const cur = summarize(ledger.lines, accounts, period.range), prev = summarize(ledger.lines, accounts, period.prev.range), ytd = summarize(ledger.lines, accounts, period.ytd.range);
  const checks = ledgerChecks(ledger, input), failed = checks.filter((c) => !c.ok);
  const warnings = doubleCountWarnings(input);
  const tile = (label: string, v: number, pv: number) => { const d = variance(v, pv); return <div className="stat" key={label}>{label}<b>{fmtAmount(v)}</b><span className="muted">vs {period.prev.label}: {fmtAmount(pv)} ({d.percent === null ? "n/a" : fmtPercent(d.percent)})</span></div>; };
  const overview = buildReport("monthly-overview", ledger, accounts, { ...p, period: p.period ?? "month" }, today);
  return (
    <>
      <PeriodForm action="/accounting" p={p} today={today} compare={false} />
      <div className="note">{period.label} · Cash basis: income counts when it is received and expenses when they are paid. Figures are calculated from your income, expense and supply records.</div>
      {(failed.length > 0 || ledger.problems.length > 0) && <div className="card err"><b>The books need attention.</b> <Link href="/accounting/tools">Open Accounting Tools</Link> for details.</div>}
      <div className="card grid2">
        {tile("Revenue", cur.revenue, prev.revenue)}{tile("Cost of services", cur.cost, prev.cost)}{tile("Gross profit", cur.grossProfit, prev.grossProfit)}
        {tile("Operating expenses", cur.opex, prev.opex)}{tile("Net income", cur.netIncome, prev.netIncome)}
        <div className="stat">Margins<b>{fmtPercent(cur.grossMargin)} gross</b><span className="muted">{fmtPercent(cur.netMargin)} net · year to date net income {fmtAmount(ytd.netIncome)}</span></div>
      </div>
      {overview && <ReportView doc={overview} />}
      {warnings.length > 0 && <div className="card"><h2>Possible double counting</h2><ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
      <p className="muted">Balance Sheet and Cash Flow are not available yet; they need opening balances and bank records. See <Link href="/accounting/reports">Financial Reports</Link>.</p>
    </>
  );
}
