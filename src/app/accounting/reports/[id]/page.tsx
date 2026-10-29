import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { loadBooks, flatParams } from "@/lib/accountingPage";
import { buildReport, REPORT_IDS } from "@/lib/reports";
import { todayInChicago } from "@/lib/dates";
import { PeriodForm } from "@/components/accounting/PeriodForm";
import { ReportView } from "@/components/accounting/ReportView";
import { PrintButton } from "@/components/accounting/PrintButton";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const p = flatParams(await searchParams), today = todayInChicago();
  await requireOwner();
  const { accounts, ledger } = await loadBooks();
  const doc = buildReport(id, ledger, accounts, p, today);
  if (!doc) notFound();
  const exportable = REPORT_IDS.includes(id);
  const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined) as [string, string][]);
  const link = (format: string) => `/api/accounting/export?${new URLSearchParams({ report: id, format, ...Object.fromEntries(qs) }).toString()}`;
  const opts = id === "income-statement" || id === "cost-of-services";
  return (
    <>
      <p><Link href="/accounting/reports">← All reports</Link></p>
      {!doc.blocked && <PeriodForm action={`/accounting/reports/${id}`} p={p} today={today} compare={opts} />}
      {exportable && !doc.blocked && <div className="row noprint"><PrintButton /><a className="btn secondary" href={link("pdf")}>Download PDF</a><a className="btn secondary" href={link("xlsx")}>Download Excel</a></div>}
      <ReportView doc={doc} />
    </>
  );
}
