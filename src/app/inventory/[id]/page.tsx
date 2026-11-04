import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, getItem, listMovements, listLotUses, addMovement, setReorderLevel, insertLotUses, warnDaysByItem, setWarnDays } from "@/lib/db";
import { KINDS, KIND_LABELS, REASONS, REASON_LABELS, isLowStock, parseMovementForm, parseReorder, replay } from "@/lib/inventory";
import { DEFAULT_WARN_DAYS, backfillAllocations, expiryStatus, lotBalances, unassignedRemovals } from "@/lib/lots";
import { formatCents } from "@/lib/money";
import { todayInChicago } from "@/lib/dates";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";
const back = (id: number, q: string) => redirect(`/inventory/${id}?${q}`);
const itemId = (fd: FormData) => (/^\d{1,12}$/.test(String(fd.get("item_id") ?? "")) ? Number(fd.get("item_id")) : 0);

async function addMove(fd: FormData) {
  "use server";
  await requireOwner();
  const raw: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") raw[k] = v;
  const id = itemId(fd);
  const parsed = parseMovementForm(raw);
  if (!parsed.ok) return back(id, `error=${encodeURIComponent(parsed.errors.join(" | "))}`);
  // lots to take from: explicit amounts win; otherwise earliest-expiring first when "auto" is ticked
  const manual: { lot_number: string; quantity: number }[] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (!k.startsWith("alloc:") || v.trim() === "") continue;
    if (!/^\d{1,7}$/.test(v.trim())) return back(id, `error=${encodeURIComponent("Lot amounts must be whole numbers.")}`);
    if (Number(v) > 0) manual.push({ lot_number: k.slice(6), quantity: Number(v) });
  }
  const err = await addMovement(parsed.value, manual.length ? manual : raw.auto === "on" ? "auto" : []);
  return back(id, err ? `error=${encodeURIComponent(err)}` : "saved=1");
}

async function writeOff(fd: FormData) {
  "use server";
  await requireOwner();
  const id = itemId(fd), lot = String(fd.get("lot_number") ?? "");
  const lots = lotBalances(await listMovements(id), await listLotUses(id));
  const l = lots.find((x) => x.lot_number === lot);
  if (!l || l.onHand < 1 || !l.expires_on || l.expires_on >= todayInChicago()) return back(id, `error=${encodeURIComponent("That lot has nothing expired to write off.")}`);
  const err = await addMovement({ item_id: id, moved_on: todayInChicago(), kind: "adjust_down", quantity: l.onHand, unit_cost_cents: null, reason: "expired", lot_number: null, expires_on: null }, [{ lot_number: lot, quantity: l.onHand }]);
  return back(id, err ? `error=${encodeURIComponent(err)}` : "saved=1");
}

async function assignPast(fd: FormData) {
  "use server";
  await requireOwner();
  const id = itemId(fd);
  await insertLotUses(backfillAllocations(await listMovements(id), await listLotUses(id)));
  return back(id, "saved=1");
}

async function saveLevel(fd: FormData) {
  "use server";
  await requireOwner();
  const id = itemId(fd);
  const level = parseReorder(String(fd.get("reorder_level") ?? ""));
  if (level === "bad") return back(id, `error=${encodeURIComponent("Reorder level: a whole number, or leave empty for no alert.")}`);
  if (id && (await getItem(id))) await setReorderLevel(id, level);
  return back(id, "saved=1");
}

async function saveWarn(fd: FormData) {
  "use server";
  await requireOwner();
  const id = itemId(fd), raw = String(fd.get("warn_days") ?? "").trim();
  if (raw !== "" && (!/^\d{1,3}$/.test(raw) || Number(raw) > 730)) return back(id, `error=${encodeURIComponent("Expiry warning: whole days from 0 to 730, or leave empty for the default.")}`);
  if (id && (await getItem(id))) await setWarnDays(id, raw === "" ? null : Number(raw));
  return back(id, "saved=1");
}

export default async function Item({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const { id: rawId } = await params;
  if (!/^\d{1,12}$/.test(rawId)) notFound();
  const item = await getItem(Number(rawId));
  if (!item) notFound();
  const sp = await searchParams;
  const moves = await listMovements(item.id), uses = await listLotUses(item.id);
  const warn = (await warnDaysByItem()).get(item.id) ?? null;
  const today = todayInChicago();
  const r = replay(moves);
  const stock = r.ok ? r : { onHand: 0, valueCents: 0, avgCostCents: 0 };
  const lots = lotBalances(moves, uses);
  const pending = unassignedRemovals(moves, uses);
  const pendingTotal = pending.reduce((s, p) => s + p.unassigned, 0);
  const badge: Record<string, string> = { expired: "expired", soon: "expires soon", ok: "", none: "" };
  return (
    <main>
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
          <SubmitButton className="btn secondary">Save</SubmitButton>
        </form>
        <form action={saveWarn} className="row" style={{ marginTop: 10 }}>
          <input type="hidden" name="item_id" value={item.id} />
          <label htmlFor="wd" style={{ margin: 0 }}>Warn about expiry (days ahead)</label>
          <input id="wd" name="warn_days" type="number" min={0} max={730} defaultValue={warn ?? ""} placeholder={`${DEFAULT_WARN_DAYS} (default)`} style={{ maxWidth: 140 }} />
          <SubmitButton className="btn secondary">Save</SubmitButton>
        </form>
      </div>
      {lots.length > 0 && (
        <div className="card tablewrap">
          <h2>Lots</h2>
          <table>
            <thead><tr><th>Lot</th><th>Expires</th><th className="num">Received</th><th className="num">Used</th><th className="num">On hand</th><th /></tr></thead>
            <tbody>{lots.map((l) => {
              const st = expiryStatus(l.expires_on, today, warn ?? DEFAULT_WARN_DAYS);
              return (
                <tr key={l.lot_number}>
                  <td>{l.lot_number}</td><td>{l.expires_on ?? "none"} {l.onHand > 0 && badge[st] && <span className="badge">{badge[st]}</span>}</td>
                  <td className="num">{l.received}</td><td className="num">{l.used}</td><td className="num">{l.onHand}</td>
                  <td>{st === "expired" && l.onHand > 0 && (
                    <form action={writeOff} className="inline"><input type="hidden" name="item_id" value={item.id} /><input type="hidden" name="lot_number" value={l.lot_number} /><SubmitButton className="linkbtn">Write off {l.onHand}</SubmitButton></form>
                  )}</td>
                </tr>
              );
            })}</tbody>
          </table>
          <p className="muted">Writing off removes the expired units at the average cost with the reason &ldquo;expired&rdquo;. It is not recorded as an expense.</p>
          {pendingTotal > 0 && (
            <form action={assignPast}>
              <input type="hidden" name="item_id" value={item.id} />
              <p>{pendingTotal} unit{pendingTotal === 1 ? "" : "s"} of past use {pendingTotal === 1 ? "is" : "are"} not assigned to a lot, so lot counts may be too high.</p>
              <SubmitButton className="btn secondary">Assign past uses (earliest-expiring first)</SubmitButton>
            </form>
          )}
        </div>
      )}
      <form action={addMove} className="card">
        <h2>Record a change</h2>
        <input type="hidden" name="item_id" value={item.id} />
        <label htmlFor="k">Type</label>
        <select id="k" name="kind" defaultValue="purchase">{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
        <label htmlFor="d">Date</label><input id="d" name="moved_on" type="date" defaultValue={today} required />
        <label htmlFor="q">Quantity (whole {item.unit})</label><input id="q" name="quantity" type="number" min={1} required />
        <label htmlFor="uc">Cost per {item.unit} ($): opening stock and purchases only</label><input id="uc" name="unit_cost" type="text" inputMode="decimal" placeholder="0.00" />
        <label htmlFor="rs">Reason: adjustments only</label>
        <select id="rs" name="reason" defaultValue=""><option value="">(none)</option>{REASONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        <label htmlFor="ln">Lot number (optional, purchases and opening stock)</label><input id="ln" name="lot_number" type="text" maxLength={40} />
        <label htmlFor="ex">Expiration date (optional; one date per lot number)</label><input id="ex" name="expires_on" type="date" />
        {lots.some((l) => l.onHand > 0) && (
          <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, marginTop: 12 }}>
            <legend>Taking from lots (uses and removals)</legend>
            <label className="check"><input type="checkbox" name="auto" defaultChecked /> Choose lots automatically, earliest expiry first</label>
            <p className="muted">Or enter amounts below (these win over automatic):</p>
            {lots.filter((l) => l.onHand > 0).map((l) => (
              <div key={l.lot_number} className="row"><label htmlFor={`a-${l.lot_number}`} style={{ margin: 0, minWidth: 140 }}>{l.lot_number} ({l.onHand} left)</label>
                <input id={`a-${l.lot_number}`} name={`alloc:${l.lot_number}`} type="number" min={0} max={l.onHand} style={{ maxWidth: 100 }} /></div>
            ))}
          </fieldset>
        )}
        <p className="muted">Not counted as an expense, and using stock is not counted as a visit. Mistakes are fixed with an adjustment; history is never edited.</p>
        <p><SubmitButton className="btn">Save</SubmitButton></p>
      </form>
      <div className="card tablewrap">
        <h2>History</h2>
        {moves.length === 0 ? <p className="muted">No changes yet. Start with opening stock.</p> : (
          <table>
            <thead><tr><th>Date</th><th>Change</th><th className="num">Qty</th><th className="num">Cost each</th><th>Lot</th><th>Expires</th></tr></thead>
            <tbody>{[...moves].reverse().map((m) => {
              const taken = uses.filter((u) => u.movement_id === m.id);
              return (
                <tr key={m.id}>
                  <td>{m.moved_on}</td><td>{KIND_LABELS[m.kind]}{m.reason ? `: ${REASON_LABELS[m.reason]}` : ""}</td>
                  <td className="num">{m.kind === "use" || m.kind === "adjust_down" ? "-" : "+"}{m.quantity}</td>
                  <td className="num">{m.unit_cost_cents === null ? "" : formatCents(m.unit_cost_cents)}</td>
                  <td>{m.lot_number ?? taken.map((u) => `${u.lot_number}×${u.quantity}`).join(", ")}</td><td>{m.expires_on ?? ""}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
    </main>
  );
}
