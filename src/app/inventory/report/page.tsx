import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, listItems, listMovements } from "@/lib/db";
import { inventoryReport } from "@/lib/lots";
import { formatCents } from "@/lib/money";
import { todayInChicago } from "@/lib/dates";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function Report({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const sp = await searchParams;
  const year = /^\d{4}$/.test(sp.year ?? "") && Number(sp.year) >= 2000 && Number(sp.year) <= 2100 ? Number(sp.year) : Number(todayInChicago().slice(0, 4));
  const rep = inventoryReport(await listItems(), await listMovements(), `${year}-01-01`, `${year}-12-31`);
  const t = rep.totals, f = formatCents;
  return (
    <main>
      <Nav />
      <p><Link href="/inventory">← Inventory</Link></p>
      <h1>Inventory report {year}</h1>
      <div className="note">For your tax preparer. Values use the weighted-average cost at the time of each change. Purchases and write-offs are shown here but are not recorded as expenses, and nothing here is tax advice.</div>
      <form method="get" className="card row">
        <label htmlFor="y" style={{ margin: 0 }}>Year</label>
        <input id="y" name="year" type="number" min={2000} max={2100} defaultValue={year} style={{ maxWidth: 120 }} />
        <SubmitButton className="btn secondary">Show</SubmitButton>
        <a className="btn secondary" href={`/api/inventory-report?year=${year}`}>Download CSV</a>
      </form>
      {rep.problems.length > 0 && <div className="card err">{rep.problems.map((p) => <div key={p}>{p}</div>)}</div>}
      <div className="card grid2">
        <div className="stat">Value on Jan 1<b>{f(t.beginValue)}</b></div>
        <div className="stat">Purchases (incl. opening stock)<b>{f(t.purchaseValue + t.openingValue)}</b></div>
        <div className="stat">Used<b>{f(t.useValue)}</b></div>
        <div className="stat">Expired write-offs<b>{f(t.writeOffValue)}</b></div>
        <div className="stat">Other adjustments (net)<b>{f(t.adjUpValue - t.adjDownValue)}</b></div>
        <div className="stat">Value on Dec 31<b>{f(t.endValue)}</b></div>
      </div>
      <div className="card tablewrap">
        <table>
          <thead><tr><th>Item</th><th className="num">Start qty</th><th className="num">Start value</th><th className="num">Bought</th><th className="num">Used</th><th className="num">Written off</th><th className="num">End qty</th><th className="num">End value</th></tr></thead>
          <tbody>{rep.rows.map((r) => <tr key={r.item_id}><td>{r.label}</td><td className="num">{r.beginQty}</td><td className="num">{f(r.beginValue)}</td><td className="num">{r.purchaseQty + r.openingQty}</td><td className="num">{r.useQty}</td><td className="num">{r.writeOffQty}</td><td className="num">{r.endQty}</td><td className="num">{f(r.endValue)}</td></tr>)}</tbody>
        </table>
      </div>
    </main>
  );
}
