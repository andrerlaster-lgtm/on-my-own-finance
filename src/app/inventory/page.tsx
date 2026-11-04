import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, listItems, addItem, listMovements, listLotUses, warnDaysByItem } from "@/lib/db";
import { expiryAlerts } from "@/lib/lots";
import { todayInChicago } from "@/lib/dates";
import { isLowStock, parseItemForm } from "@/lib/inventory";
import { formatCents } from "@/lib/money";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

async function add(form: FormData) {
  "use server";
  await requireOwner();
  const raw: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") raw[k] = v;
  const parsed = parseItemForm(raw);
  if (!parsed.ok) redirect(`/inventory?error=${encodeURIComponent(parsed.errors.join(" | "))}`);
  const r = await addItem(parsed.value);
  if (!r.ok) redirect(`/inventory?error=${encodeURIComponent(r.error)}`);
  redirect(`/inventory/${r.id}`);
}

export default async function Inventory({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const sp = await searchParams;
  const items = await listItems();
  const total = items.reduce((s, i) => s + i.stock.valueCents, 0);
  const alerts = expiryAlerts(items, await listMovements(), await listLotUses(), await warnDaysByItem(), todayInChicago());
  const low = items.filter((i) => isLowStock(i.stock.onHand, i.reorder_level));
  return (
    <main>
      <h1>Inventory</h1>
      <div className="note">Inventory is tracked on its own. A purchase here is not counted as an expense yet, and using supplies is not counted as a visit. Do not put patient information in any field.</div>
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      <p className="row"><Link className="btn secondary" href="/inventory/lots">Lot lookup</Link><Link className="btn secondary" href="/inventory/report">Year-end report</Link></p>
      {alerts.length > 0 && <div className="card"><h2>Expiry</h2><ul className="plain">{alerts.map((a) => <li key={`${a.item_id}${a.lot_number}`}><Link href={`/inventory/${a.item_id}`}>{a.label}</Link> lot {a.lot_number}: {a.onHand} {a.unit}, {a.status === "expired" ? `expired ${-a.daysLeft} day${a.daysLeft === -1 ? "" : "s"} ago` : `expires in ${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"}`}</li>)}</ul></div>}
      {low.length > 0 && <div className="card"><h2>Low stock</h2><ul className="plain">{low.map((i) => <li key={i.id}><Link href={`/inventory/${i.id}`}>{i.label}</Link>: {i.stock.onHand} {i.unit} (reorder at {i.reorder_level})</li>)}</ul></div>}
      <div className="card tablewrap">
        <h2>Items</h2>
        {items.length === 0 ? <p className="muted">No items yet. Add one below, then record its opening stock.</p> : (
          <table>
            <thead><tr><th>Item</th><th>Category</th><th className="num">On hand</th><th className="num">Avg cost</th><th className="num">Value</th><th>Reorder at</th></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id}>
                <td><Link href={`/inventory/${i.id}`}>{i.label}</Link> {isLowStock(i.stock.onHand, i.reorder_level) && <span className="badge">low</span>}{i.error && <span className="err"> check history</span>}</td>
                <td>{i.category}</td><td className="num">{i.stock.onHand} {i.unit}</td><td className="num">{formatCents(i.stock.avgCostCents)}</td><td className="num">{formatCents(i.stock.valueCents)}</td><td>{i.reorder_level ?? "none"}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><th colSpan={4}>Total inventory value</th><th className="num">{formatCents(total)}</th><th /></tr></tfoot>
          </table>
        )}
      </div>
      <form action={add} className="card">
        <h2>Add an item</h2>
        <label htmlFor="l">Item name</label><input id="l" name="label" type="text" maxLength={80} required />
        <label htmlFor="c">Category</label><input id="c" name="category" type="text" maxLength={40} placeholder="General" />
        <label htmlFor="u">Unit (always count it the same way: box, pack, each)</label><input id="u" name="unit" type="text" maxLength={20} required />
        <label htmlFor="r">Reorder level (optional: alert at or below this many)</label><input id="r" name="reorder_level" type="number" min={0} />
        <p><SubmitButton className="btn">Add item</SubmitButton></p>
      </form>
    </main>
  );
}
