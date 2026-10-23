import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, listItems, listMovements, listLotUses } from "@/lib/db";
import { lotHistory } from "@/lib/lots";
import { KIND_LABELS } from "@/lib/inventory";
import { formatCents } from "@/lib/money";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function LotLookup({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const sp = await searchParams;
  const lot = (sp.lot ?? "").trim();
  const valid = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/.test(lot);
  const found = valid ? lotHistory(lot, await listItems(), await listMovements(), await listLotUses()) : [];
  return (
    <main>
      <Nav />
      <p><Link href="/inventory">← Inventory</Link></p>
      <h1>Lot lookup</h1>
      <div className="note">Shows when a lot arrived, its expiry, and when and how much was used. Uses are not linked to visits or people, so a lot cannot be traced to a patient from here.</div>
      <form method="get" className="card row">
        <label htmlFor="l" style={{ margin: 0 }}>Lot number</label>
        <input id="l" name="lot" type="text" maxLength={40} defaultValue={lot} style={{ maxWidth: 220 }} />
        <button className="btn secondary" type="submit">Look up</button>
      </form>
      {lot && !valid && <div className="card err">Lot numbers use letters, numbers and . _ / - only.</div>}
      {lot && valid && found.length === 0 && <div className="card">No lot with that number.</div>}
      {found.map((h) => (
        <div className="card tablewrap" key={h.item_id}>
          <h2><Link href={`/inventory/${h.item_id}`}>{h.label}</Link> · lot {lot}</h2>
          <p>Expires {h.expires_on ?? "(no date)"} · {h.onHand} {h.unit} left</p>
          <table>
            <thead><tr><th>Date</th><th>What</th><th className="num">Qty</th><th className="num">Cost each</th></tr></thead>
            <tbody>
              {h.received.map((x, i) => <tr key={`r${i}`}><td>{x.date}</td><td>Received</td><td className="num">+{x.quantity}</td><td className="num">{x.unit_cost_cents === null ? "" : formatCents(x.unit_cost_cents)}</td></tr>)}
              {h.used.map((x, i) => <tr key={`u${i}`}><td>{x.date}</td><td>{KIND_LABELS[x.kind]}</td><td className="num">-{x.quantity}</td><td /></tr>)}
            </tbody>
          </table>
        </div>
      ))}
    </main>
  );
}
