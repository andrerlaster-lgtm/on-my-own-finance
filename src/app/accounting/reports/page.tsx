import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { REPORTS } from "@/lib/reports";
import { NOT_YET_AVAILABLE } from "@/lib/statements";

export const dynamic = "force-dynamic";

export default async function Reports() {
  await requireOwner();
  return (
    <>
      <div className="note">All reports are cash basis and come from the same ledger, so they always agree with each other. Every amount links to the transactions behind it.</div>
      <div className="tools">
        {REPORTS.map((r) => <div className="card" key={r.id}><h2>{r.title}</h2><p className="muted">{r.blurb}</p><Link className="btn" href={`/accounting/reports/${r.id}`}>Open</Link></div>)}
        {NOT_YET_AVAILABLE.map((r) => <div className="card" key={r.id}><h2>{r.title} <span className="muted">not available yet</span></h2><p className="muted">{r.why}</p></div>)}
      </div>
    </>
  );
}
