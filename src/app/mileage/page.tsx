import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, listTripsAll, addTrip, deleteTrip, getRules } from "@/lib/db";
import { PURPOSES, PURPOSE_LABELS, formatMiles, mileageSummary, parseTripForm, type RateInfo } from "@/lib/mileage";
import { formatCents } from "@/lib/money";
import { periodRanges, todayInChicago } from "@/lib/dates";
import { rowsToShow } from "@/lib/paging";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

async function add(fd: FormData) {
  "use server";
  await requireOwner();
  const raw: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") raw[k] = v;
  const parsed = parseTripForm(raw);
  if (!parsed.ok) redirect(`/mileage?error=${encodeURIComponent(parsed.errors.join(" | "))}`);
  await addTrip(parsed.value);
  redirect("/mileage?saved=1");
}

async function remove(fd: FormData) {
  "use server";
  await requireOwner();
  const id = Number(fd.get("id"));
  if (Number.isInteger(id) && id > 0) await deleteTrip(id);
  redirect("/mileage");
}

export default async function Mileage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; rows?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const sp = await searchParams;
  const today = todayInChicago();
  const p = periodRanges(today);
  const year = Number(today.slice(0, 4));
  const trips = await listTripsAll(p.year.from, p.year.to);
  const rules = await getRules(year);
  const shown = rowsToShow(sp.rows);
  const rates: Record<number, RateInfo> = { [year]: { centsPerMile: rules.mileage_rate_cents, confirmed: rules.mileage_rate_confirmed, h2CentsPerMile: rules.mileage_rate_h2_cents, h2Confirmed: rules.mileage_rate_h2_confirmed } };
  const m = mileageSummary(trips, p.month, rates), y = mileageSummary(trips, p.year, rates);
  return (
    <main>
      <h1>Mileage</h1>
      <div className="note">One row per trip. No addresses or places are stored (a stop could be a patient&rsquo;s home). The deduction is an estimate: whether to use the standard mileage rate, and the rate itself, are for your tax preparer. If you use it, do not also enter actual vehicle costs as expenses.</div>
      {sp.saved && <div className="note">Saved.</div>}
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      <div className="card grid2">
        <div className="stat">Miles this month<b>{formatMiles(m.miles_tenths)}</b></div>
        <div className="stat">Miles this year<b>{formatMiles(y.miles_tenths)}</b></div>
        <div className="stat">Estimated deduction this year<b>{rules.mileage_rate_cents === null ? "rate not set" : formatCents(y.deductionCents)}</b></div>
      </div>
      {rules.mileage_rate_cents === null && <div className="note">No mileage rate is set for {year}. Add it under Tax rules (and confirm it with your preparer).</div>}
      {rules.mileage_rate_cents !== null && !rules.mileage_rate_confirmed && <div className="note">The {year} mileage rate is not confirmed with your preparer yet, so this deduction is only a guess.</div>}
      <form action={add} className="card">
        <h2>Add a trip</h2>
        <label htmlFor="d">Date</label><input id="d" name="driven_on" type="date" defaultValue={today} required />
        <label htmlFor="m">Miles (one decimal)</label><input id="m" name="miles" type="text" inputMode="decimal" placeholder="0.0" required />
        <label htmlFor="p">Purpose</label>
        <select id="p" name="purpose" defaultValue="patient_visits">{PURPOSES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        <label htmlFor="os">Odometer start (optional)</label><input id="os" name="odometer_start" type="number" min={0} />
        <label htmlFor="oe">Odometer end (optional)</label><input id="oe" name="odometer_end" type="number" min={0} />
        <p><SubmitButton className="btn">Add trip</SubmitButton></p>
      </form>
      <div className="card">
        <h2>This year ({trips.length})</h2>
        {trips.length === 0 ? <p className="muted">No trips yet.</p> : (
          <ul className="entries">{trips.slice(0, shown).map((t) => (
            <li className="entry" key={t.id}>
              <span className="what">{PURPOSE_LABELS[t.purpose]}</span>
              <span className="amt">{formatMiles(t.miles_tenths)} mi</span>
              <span className="meta">{t.driven_on}{t.odometer_start === null ? "" : ` · odometer ${t.odometer_start} to ${t.odometer_end}`}</span>
              <div className="acts"><form action={remove} className="inline"><input type="hidden" name="id" value={t.id} /><SubmitButton className="linkbtn">Delete</SubmitButton></form></div>
            </li>
          ))}</ul>
        )}
        {trips.length > shown && <p><Link href={`/mileage?rows=${shown + 200}`}>Show 200 more ({trips.length - shown} older)</Link></p>}
      </div>
    </main>
  );
}
