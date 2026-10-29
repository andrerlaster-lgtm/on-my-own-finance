"use client";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import type { SaveState } from "@/lib/mileageService";

export interface TripDefaults {
  driven_on: string; start_label: string; end_label: string; purpose: string; trip_type: string; category: string; remarks: string;
  estimate_tenths: string; estimate_source: string; actual_miles: string; odometer_start: string; odometer_end: string;
}
type Opt = { id: string; label: string };
const miles = (t: number) => (t / 10).toFixed(1);

/** Add or edit a trip. "Calculate" asks the server for a road-route estimate; nothing is saved until you press the save button. */
export function TripForm({ action, defaults, favorites, purposes, categories, routingReady, submitLabel }: {
  action: (prev: SaveState, fd: FormData) => Promise<SaveState>; defaults: TripDefaults; favorites: string[]; purposes: Opt[]; categories: Opt[]; routingReady: boolean; submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, {} as SaveState);
  const [from, setFrom] = useState(defaults.start_label), [to, setTo] = useState(defaults.end_label);
  const [fromStreet, setFromStreet] = useState(""), [toStreet, setToStreet] = useState("");
  const [round, setRound] = useState(defaults.trip_type === "round_trip");
  const [est, setEst] = useState<{ tenths: number; source: string } | null>(defaults.estimate_tenths ? { tenths: Number(defaults.estimate_tenths), source: defaults.estimate_source || "route_city" } : null);
  const [actual, setActual] = useState(defaults.actual_miles);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const stale = () => { setEst(null); setMsg(null); };
  const actualTenths = /^\d{1,4}(\.\d)?$/.test(actual.trim()) ? Math.round(Number(actual) * 10) : null;
  const estTotal = est ? est.tenths * (round ? 2 : 1) : null;
  const total = actualTenths ?? estTotal;
  async function calculate() {
    setBusy(true); setMsg(null);
    try {
      const q = new URLSearchParams({ from, to, fromStreet, toStreet });
      const r = await (await fetch(`/api/mileage/estimate?${q}`)).json() as { ok: boolean; oneWayTenths?: number; source?: string; message?: string };
      if (r.ok && r.oneWayTenths) setEst({ tenths: r.oneWayTenths, source: r.source ?? "route_city" });
      else { setEst(null); setMsg(r.message ?? "The estimate could not be calculated. Type the miles yourself."); }
    } catch { setEst(null); setMsg("The estimate could not be calculated. Type the miles yourself."); }
    setBusy(false);
  }
  return (
    <form action={formAction} className="card">
      {state.errors && <div className="card err">{state.errors.map((e) => <div key={e}>{e}</div>)}</div>}
      <label htmlFor="d">Trip date</label><input id="d" name="driven_on" type="date" defaultValue={defaults.driven_on} required />
      <datalist id="places">{favorites.map((f) => <option key={f} value={f} />)}</datalist>
      <label htmlFor="sl">Starting location (city)</label>
      <input id="sl" name="start_label" list="places" value={from} onChange={(e) => { setFrom(e.target.value); stale(); }} placeholder="Abilene, TX" autoComplete="off" required />
      <label htmlFor="el">Destination (city)</label>
      <input id="el" name="end_label" list="places" value={to} onChange={(e) => { setTo(e.target.value); stale(); }} placeholder="Dallas, TX" autoComplete="off" required />
      <details className="mini"><summary>Add street addresses for a more accurate estimate (optional)</summary>
        <p className="muted">Used only for this estimate and sent to the routing service. They are not saved with the trip. Do not type a patient&rsquo;s name.</p>
        <label htmlFor="fs">Starting street address</label><input id="fs" value={fromStreet} onChange={(e) => { setFromStreet(e.target.value); stale(); }} maxLength={80} autoComplete="off" />
        <label htmlFor="ts">Destination street address</label><input id="ts" value={toStreet} onChange={(e) => { setToStreet(e.target.value); stale(); }} maxLength={80} autoComplete="off" />
      </details>
      <fieldset className="radios"><legend>One-way or round trip</legend>
        <label className="check"><input type="radio" name="trip_type" value="one_way" checked={!round} onChange={() => setRound(false)} /> One way</label>
        <label className="check"><input type="radio" name="trip_type" value="round_trip" checked={round} onChange={() => setRound(true)} /> Round trip</label>
      </fieldset>
      <p><button type="button" className="btn secondary" onClick={calculate} disabled={busy || !routingReady || !from || !to}>{busy ? "Calculating…" : "Calculate estimated miles"}</button></p>
      {!routingReady && <p className="muted">Automatic estimates are not set up yet (no routing key on the server). Type the miles below.</p>}
      {msg && <div className="note" role="status">{msg}</div>}
      <input type="hidden" name="estimate_tenths" value={est ? String(est.tenths) : ""} /><input type="hidden" name="estimate_source" value={est?.source ?? ""} />
      <div className="grid2">
        <div className="stat">Estimated miles<b>{estTotal === null ? "not calculated" : miles(estTotal)}</b>
          <span className="muted">{est ? `${est.source === "route_address" ? "Road-route estimate using street addresses" : "Road-route estimate, city to city"}${round ? ` (${miles(est.tenths)} each way)` : ""}. An estimate, not verified miles.` : "Press Calculate."}</span></div>
        <div className="stat">Total miles counted<b>{total === null ? "—" : miles(total)}</b>
          <span className="muted">{total === null ? "Needs an estimate or actual miles." : actualTenths !== null ? "Actual (what you entered)" : "Estimated"}</span></div>
      </div>
      <label htmlFor="am">Actual miles driven, total (optional; replaces the estimate)</label>
      <input id="am" name="actual_miles" inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="Leave empty to use the estimate" />
      <label htmlFor="ca">Trip type</label>
      <select id="ca" name="category" defaultValue={defaults.category}>{categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
      <p className="muted">Only business trips count toward the deduction. Personal and commuting trips are kept but never included.</p>
      <label htmlFor="pu">Business purpose</label>
      <select id="pu" name="purpose" defaultValue={defaults.purpose}>{purposes.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
      <label htmlFor="rm">Notes (optional)</label><input id="rm" name="remarks" maxLength={200} defaultValue={defaults.remarks} />
      <details className="mini"><summary>Odometer readings (optional)</summary>
        <label htmlFor="os">Odometer start</label><input id="os" name="odometer_start" type="number" min={0} defaultValue={defaults.odometer_start} />
        <label htmlFor="oe">Odometer end</label><input id="oe" name="odometer_end" type="number" min={0} defaultValue={defaults.odometer_end} />
      </details>
      <label className="check"><input type="checkbox" name="save_places" value="1" /> Remember these cities for next time</label>
      {state.duplicate && <label className="check"><input type="checkbox" name="allow_duplicate" value="1" /> Save it anyway</label>}
      <p><SubmitButton className="btn">{submitLabel}</SubmitButton></p>
    </form>
  );
}
