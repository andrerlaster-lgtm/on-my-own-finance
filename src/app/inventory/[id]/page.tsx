import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, getItem, listMovements, addMovement, setReorderLevel } from "@/lib/db";
import { KINDS, KIND_LABELS, REASONS, REASON_LABELS, isLowStock, parseMovementForm, parseReorder, replay } from "@/lib/inventory";
import { formatCents } from "@/lib/money";
import { todayInChicago } from "@/lib/dates";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

async function addMove(form: FormData) {
  "use server";
  await requireOwner();
  const raw: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") raw[k] = v;
  const id = /^\d{1,12}$/.test(raw.item_id ?? "") ? Number(raw.item_id) : 0;
  const parsed = parseMovementForm(raw);
  if (!parsed.ok) redirect(`/inventory/${id}?error=${encodeURIComponent(parsed.errors.join(" | "))}`);
  const err = await addMovement(parsed.value);
  redirect(err ? `/inventory/${id}?error=${encodeURIComponent(err)}` : `/inventory/${id}?saved=1`);
}

async function saveLevel(form: FormData) {
  "use server";
  await requireOwner();
  const id = /^\d{1,12}$/.test(String(form.get("item_id") ?? "")) ? Number(form.get("item_id")) : 0;
  const level = parseReorder(String(form.get("reorder_level") ?? ""));
  if (level === "bad") redirect(`/inventory/${id}?error=${encodeURIComponent("Reorder level: a whole number, or leave empty for no alert.")}`);
  if (id && (await getItem(id))) await setReorderLevel(id, level);
  redirect(`/inventory/${id}?saved=1`);
}

export default async function Item({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const { id: rawId } = await params;
  if (!/^\d{1,12}$/.test(rawId)) notFound();
  const item = await getItem(Number(rawId));
  if (!item) notFound();
  const sp = await searchParams;
  const moves = await listMovements(item.id);
  const r = replay(moves);
  const stock = r.ok ? r : { onHand: 0, valueCents: 0, avgCostCents: 0 };
  return (
    <main>
      <Nav />
      <p><Link href="/inventory">← Inventory</Link></p>
      <h1>{item.label}</h1>
      <p className="muted">{item.category} · counted in {item.unit}</p>
      {sp.saved && <div className="note">Saved.</div>}
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      {!r.ok && <div className="card err">History problem: {r.error}</div>}
      <div className="card">
        <div className="grid2">
          <div className="stat">On hand<b>{stock.onHand} {item.unit}{isLowStock(stock.onHand, item.reorder_level) ? " (low)" : ""}</b></div>
          <div className="stat">Average cost<b>{formatCents(stock.avgCostCents)}</b></div>
          <div className="stat">Value<b>{formatCents(stock.valueCents)}</b></div>
        </div>
        <form action={saveLevel} className="row" style={{ marginTop: 10 }}>
          <input type="hidden" name="item_id" value={item.id} />
          <label htmlFor="rl" style={{ margin: 0 }}>Reorder level</label>
          <input id="rl" name="reorder_level" type="number" min={0} defaultValue={item.reorder_level ?? ""} placeholder="none" style={{ maxWidth: 120 }} />
          <button className="btn secondary" type="submit">Save</button>
        </form>
      </div>
      <form action={addMove} className="card">
        <h2>Record a change</h2>
        <input type="hidden" name="item_id" value={item.id} />
        <label htmlFor="k">Type</label>
        <select id="k" name="kind" defaultValue="purchase">{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
        <label htmlFor="d">Date</label><input id="d" name="moved_on" type="date" defaultValue={todayInChicago()} required />
        <label htmlFor="q">Quantity (whole {item.unit})</label><input id="q" name="quantity" type="number" min={1} required />
        <label htmlFor="uc">Cost per {item.unit} ($): opening stock and purchases only</label><input id="uc" name="unit_cost" type="text" inputMode="decimal" placeholder="0.00" />
        <label htmlFor="rs">Reason: adjustments only</label>
        <select id="rs" name="reason" defaultValue=""><option value="">(none)</option>{REASONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        <label htmlFor="ln">Lot number (optional, purchases and opening stock)</label><input id="ln" name="lot_number" type="text" maxLength={40} />
        <label htmlFor="ex">Expiration date (optional)</label><input id="ex" name="expires_on" type="date" />
        <p className="muted">Not counted as an expense, and using stock is not counted as a visit. Mistakes are fixed with an adjustment; history is never edited.</p>
        <p><button className="btn" type="submit">Save</button></p>
      </form>
      <div className="card tablewrap">
        <h2>History</h2>
        {moves.length === 0 ? <p className="muted">No changes yet. Start with opening stock.</p> : (
          <table>
            <thead><tr><th>Date</th><th>Change</th><th className="num">Qty</th><th className="num">Cost each</th><th>Lot</th><th>Expires</th></tr></thead>
            <tbody>{[...moves].reverse().map((m) => (
              <tr key={m.id}>
                <td>{m.moved_on}</td><td>{KIND_LABELS[m.kind]}{m.reason ? `: ${REASON_LABELS[m.reason]}` : ""}</td>
                <td className="num">{m.kind === "use" || m.kind === "adjust_down" ? "-" : "+"}{m.quantity}</td>
                <td className="num">{m.unit_cost_cents === null ? "" : formatCents(m.unit_cost_cents)}</td><td>{m.lot_number ?? ""}</td><td>{m.expires_on ?? ""}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </main>
  );
}
