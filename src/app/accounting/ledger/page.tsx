import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { loadBooks, flatParams } from "@/lib/accountingPage";
import { generalLedgerDoc } from "@/lib/statements";
import { parseDate, todayInChicago } from "@/lib/dates";
import { ReportView } from "@/components/accounting/ReportView";
import { PrintButton } from "@/components/accounting/PrintButton";

export const dynamic = "force-dynamic";

export default async function Ledger({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = flatParams(await searchParams), today = todayInChicago();
  await requireOwner();
  const { accounts, ledger } = await loadBooks();
  const from = parseDate(p.from) ?? `${today.slice(0, 4)}-01-01`, to = parseDate(p.to) ?? today;
  const range = from <= to ? { from, to } : { from: to, to: from };
  const account = /^\d+$/.test(p.account ?? "") && accounts.some((a) => a.id === Number(p.account)) ? Number(p.account) : null;
  const doc = generalLedgerDoc(ledger, accounts, range, account === null ? null : [account]);
  const qs = new URLSearchParams({ report: "general-ledger", period: "custom", from: range.from, to: range.to, ...(account ? { account: String(account) } : {}) });
  return (
    <>
      <form method="get" className="card period-form">
        <div className="row">
          <label>Account<select name="account" defaultValue={account ?? ""}><option value="">All accounts with activity</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.number} {a.label}{a.active ? "" : " (inactive)"}</option>)}</select></label>
          <label>From<input type="date" name="from" defaultValue={range.from} /></label>
          <label>To<input type="date" name="to" defaultValue={range.to} /></label>
        </div>
        <p><SubmitButton>Show</SubmitButton></p>
      </form>
      <div className="row noprint"><PrintButton /><a className="btn secondary" href={`/api/accounting/export?${qs}&format=pdf`}>Download PDF</a><a className="btn secondary" href={`/api/accounting/export?${qs}&format=xlsx`}>Download Excel</a></div>
      <ReportView doc={doc} />
      <p className="muted"><Link href="/accounting/reports/trial-balance">Trial balance</Link> · every ledger line links to its entry.</p>
    </>
  );
}
