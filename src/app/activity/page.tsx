import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, listActivity } from "@/lib/db";
import { describeActivity } from "@/lib/activity";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function Activity({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const sp = await searchParams;
  const before = /^\d{1,12}$/.test(sp.before ?? "") ? Number(sp.before) : null;
  const rows = await listActivity(before, 100);
  return (
    <main>
      <Nav />
      <h1>Activity</h1>
      <div className="note">What was changed and when (Central time), newest first. It records the kind of change and record numbers or amounts, never names, notes or card details. Use it to spot anything you did not do.</div>
      <div className="card tablewrap">
        {rows.length === 0 ? <p className="muted">Nothing recorded.</p> : (
          <table>
            <thead><tr><th>When</th><th>What</th><th>Details</th></tr></thead>
            <tbody>{rows.map((r) => { const d = describeActivity(r.action, r.detail); return <tr key={r.id}><td>{r.at}</td><td>{d.label}</td><td className="muted">{d.facts}</td></tr>; })}</tbody>
          </table>
        )}
        {rows.length === 100 && <p><Link href={`/activity?before=${rows[rows.length - 1].id}`}>Older →</Link></p>}
      </div>
    </main>
  );
}
