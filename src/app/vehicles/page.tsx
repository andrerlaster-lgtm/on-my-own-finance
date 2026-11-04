import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, schemaVersion, listVehicles, addVehicle, setVehicleActive, listVehicleExpenses, toSpendRow, listMaintenance, latestOdometers, listVehicleRules, ruleFor, setVehicleRule, listTripsAll, getRules } from "@/lib/db";
import { VEHICLE_CATEGORIES, TAX_METHODS, isTaxMethod, parseBusinessUse, vehicleTaxSummary, dueStatus, monthlyTotals, monthRange, parseVehicleForm, plannedEstimateTotal, spendingTotals } from "@/lib/vehicles";
import { mileageSummary, type RateInfo } from "@/lib/mileage";
import { formatCents } from "@/lib/money";
import { todayInChicago } from "@/lib/dates";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const back = (q: string): never => redirect(`/vehicles${q}`);

async function add(fd: FormData) {
  "use server";
  await requireOwner();
  const parsed = parseVehicleForm({ label: String(fd.get("label") ?? "") });
  if (!parsed.ok) return back(`?error=${encodeURIComponent(parsed.errors.join(" | "))}`);
  await addVehicle(parsed.value.label);
  back("?saved=1");
}
async function toggle(fd: FormData) {
  "use server";
  await requireOwner();
  const id = Number(fd.get("id"));
  if (Number.isInteger(id) && id > 0) await setVehicleActive(id, fd.get("active") === "1");
  back("");
}
async function chooseMethod(fd: FormData) {
  "use server";
  await requireOwner();
  const year = Number(fd.get("year")), method = fd.get("method");
  const pct = parseBusinessUse(String(fd.get("business_use") ?? ""));
  if (pct === "bad") return back(`?year=${year}&error=${encodeURIComponent("Business-use percentage: a number from 0 to 100 with at most two decimals, or leave empty.")}`);
  if (Number.isInteger(year) && year >= 2000 && year <= 2100 && isTaxMethod(method)) await setVehicleRule(year, { method, businessUsePercent: pct, businessUseConfirmed: fd.get("business_use_confirmed") === "on" });
  back(`?year=${year}&saved=1`);
}

export default async function Vehicles({ searchParams }: { searchParams: Promise<{ year?: string; month?: string; error?: string; saved?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  if (((await schemaVersion()) ?? 0) < 11) return <main><h1>Vehicles</h1><div className="note">The database needs a one-time update first. Press <b>Update</b> on the home page, then come back.</div><p><Link href="/">← Home</Link></p></main>;
  const sp = await searchParams;
  const today = todayInChicago(), thisYear = Number(today.slice(0, 4));
  const year = /^\d{4}$/.test(sp.year ?? "") && Number(sp.year) >= 2000 && Number(sp.year) <= 2100 ? Number(sp.year) : thisYear;
  const month = /^(0?[1-9]|1[0-2])$/.test(sp.month ?? "") ? Number(sp.month) : year === thisYear ? Number(today.slice(5, 7)) : 12;
  const [vehicles, spend, plans, odos, vehicleRules, trips, rules] = await Promise.all([
    listVehicles(), listVehicleExpenses(`${year}-01-01`, `${year}-12-31`, 50_001), listMaintenance(), latestOdometers(), listVehicleRules(),
    listTripsAll(`${year}-01-01`, `${year}-12-31`), getRules(year),
  ]);
  if (spend.length > 50_000) throw new Error("Too many vehicle expenses to show at once.");
  const rows = spend.map(toSpendRow);
  const label = (id: number) => vehicles.find((v) => v.id === id)?.label ?? `Vehicle ${id}`;
  const yr = spendingTotals(rows, { from: `${year}-01-01`, to: `${year}-12-31` }), mo = spendingTotals(rows, monthRange(year, month));
  const byMonth = monthlyTotals(rows, year);
  const rule = ruleFor(vehicleRules, year), method = rule.method;
  const rate: RateInfo = { centsPerMile: rules.mileage_rate_cents, confirmed: rules.mileage_rate_confirmed, h2CentsPerMile: rules.mileage_rate_h2_cents, h2Confirmed: rules.mileage_rate_h2_confirmed };
  const mi = mileageSummary(trips, { from: `${year}-01-01`, to: `${year}-12-31` }, { [year]: rate });
  const treat = vehicleTaxSummary(spend.map((e) => ({ amount_cents: e.amount_cents, vehicle_category: e.vehicle_category })), rule);
  const planned = plans.filter((p) => p.status === "planned");
  const dueNow = planned.filter((p) => dueStatus(p, today, odos.get(p.vehicle_id) ?? null) !== "upcoming");
  const catRows = (t: typeof yr) => VEHICLE_CATEGORIES.map((c) => ({ c, total: t.byCategory.find((x) => x.id === c.id)?.total ?? 0 }));
  return (
    <main>
      <h1>Vehicles</h1>
      <div className="note">Actual vehicle spending goes in the books when it is paid. Whether any of it can be claimed on taxes is your preparer&rsquo;s decision: with the standard mileage rate, fuel, repairs and the like are not claimed on top of it. No plate, VIN or patient details here.</div>
      {sp.saved && <div className="note">Saved.</div>}
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      <div className="card row">
        <Link className="btn" href="/vehicles/expenses">Add a vehicle expense</Link>
        <Link className="btn secondary" href="/vehicles/maintenance">Maintenance log</Link>
      </div>
      {dueNow.length > 0 && <div className="card"><h2>Maintenance needing attention <span className="muted">{dueNow.length}</span></h2>
        <ul className="plain">{dueNow.slice(0, 5).map((p) => <li key={p.id}>{label(p.vehicle_id)}: {p.title} ({dueStatus(p, today, odos.get(p.vehicle_id) ?? null) === "overdue" ? "overdue" : "due soon"})</li>)}</ul>
        <p className="muted"><Link href="/vehicles/maintenance">Open the maintenance log</Link></p></div>}
      <form method="get" className="card row">
        <label htmlFor="y" style={{ margin: 0 }}>Year</label><input id="y" name="year" type="number" min={2000} max={2100} defaultValue={year} style={{ maxWidth: 110 }} />
        <label htmlFor="m" style={{ margin: 0 }}>Month</label>
        <select id="m" name="month" defaultValue={String(month)} style={{ maxWidth: 110 }}>{MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}</select>
        <SubmitButton className="btn secondary">Show</SubmitButton>
      </form>
      <div className="card grid2">
        <div className="stat">{MONTHS[month - 1]} {year}, actual spending ({mo.count})<b>{formatCents(mo.total)}</b></div>
        <div className="stat">{year}, actual spending ({yr.count})<b>{formatCents(yr.total)}</b></div>
        <div className="stat">Upcoming maintenance, estimated (not in the books)<b>{formatCents(plannedEstimateTotal(planned))}</b></div>
      </div>
      <div className="card">
        <h2>{year} by vehicle</h2>
        {yr.byVehicle.length === 0 ? <p className="muted">No vehicle spending yet.</p> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Vehicle</th><th>Entries</th>{VEHICLE_CATEGORIES.map((c) => <th key={c.id}>{c.label}</th>)}<th>Total</th></tr></thead>
            <tbody>{yr.byVehicle.map((v) => <tr key={v.vehicle_id}><td>{label(v.vehicle_id)}</td><td>{v.count}</td>{VEHICLE_CATEGORIES.map((c) => <td key={c.id}>{formatCents(v.byCategory[c.id] ?? 0)}</td>)}<td><b>{formatCents(v.total)}</b></td></tr>)}</tbody>
          </table></div>
        )}
      </div>
      <div className="card">
        <h2>By category</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Category</th><th>{MONTHS[month - 1]} {year}</th><th>All of {year}</th></tr></thead>
          <tbody>{catRows(yr).map(({ c, total }) => <tr key={c.id}><td>{c.label}</td><td>{formatCents(catRows(mo).find((x) => x.c.id === c.id)!.total)}</td><td>{formatCents(total)}</td></tr>)}</tbody>
        </table></div>
      </div>
      <div className="card">
        <h2>{year} month by month</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Month</th><th>Spent</th></tr></thead>
          <tbody>{byMonth.map((t, i) => <tr key={MONTHS[i]}><td>{MONTHS[i]}</td><td>{formatCents(t)}</td></tr>)}</tbody>
        </table></div>
      </div>
      <div className="card">
        <h2>Actual spending vs. tax-deductible, {year}</h2>
        <div className="grid2">
          <div className="stat">Actual vehicle spending (in the books)<b>{formatCents(treat.actualSpendingCents)}</b></div>
          <div className="stat">Counted in tax estimates<b>{formatCents(treat.countedInTaxEstimatesCents)}</b></div>
          <div className="stat">Of which parking and tolls (counted either way)<b>{formatCents(treat.parkingTollsCents)}</b></div>
          <div className="stat">Not counted in tax estimates<b>{formatCents(treat.notCountedCents)}</b></div>
          <div className="stat">Mileage deduction estimate<b>{method === "actual" ? "not applied (records kept)" : rules.mileage_rate_cents === null ? "rate not set" : formatCents(mi.deductionCents)}</b></div>
        </div>
        {treat.warning && <div className="note" style={{ marginTop: 10 }}>{treat.warning}</div>}
        <form action={chooseMethod}>
          <input type="hidden" name="year" value={year} />
          <label htmlFor="meth">How are vehicle costs handled in tax estimates for {year}?</label>
          <select id="meth" name="method" defaultValue={method}>{TAX_METHODS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          <label htmlFor="bu">Business-use percentage (used only with actual expenses)</label>
          <input id="bu" name="business_use" type="text" inputMode="decimal" placeholder="for example 85" defaultValue={rule.businessUsePercent ?? ""} style={{ maxWidth: 140 }} />
          <label className="check"><input type="checkbox" name="business_use_confirmed" defaultChecked={rule.businessUseConfirmed} /> My tax preparer confirmed this percentage</label>
          <p className="muted">Standard mileage: fuel, service, repairs, tires and insurance are not counted (the rate covers them); parking and tolls are. Actual expenses: only the confirmed business-use share of those costs is counted, nothing is counted until the percentage is entered and confirmed, and the mileage deduction is not applied (your mileage records stay as they are). Tick the box only after your preparer has confirmed the percentage you entered. This only changes tax estimates (dashboard profit, set-aside, year-end packet); the books and reports always show every cost in full.</p>
          <p><SubmitButton className="btn secondary">Save choice</SubmitButton></p>
        </form>
      </div>
      <form action={add} className="card">
        <h2>Add a vehicle</h2>
        <label htmlFor="vl">Name (like “Work car”)</label><input id="vl" name="label" type="text" maxLength={40} autoComplete="off" required />
        <p className="muted">No plate or VIN numbers.</p>
        <p><SubmitButton className="btn">Add vehicle</SubmitButton></p>
      </form>
      <div className="card">
        <h2>Your vehicles ({vehicles.length})</h2>
        {vehicles.length === 0 ? <p className="muted">None yet.</p> : (
          <ul className="entries">{vehicles.map((v) => (
            <li className="entry" key={v.id}>
              <span className="what">{v.label}</span>
              <span className="meta">{v.active ? "In use" : "Retired"}{odos.get(v.id) ? ` · last odometer ${odos.get(v.id)!.toLocaleString("en-US")}` : ""}</span>
              <div className="acts"><form action={toggle} className="inline"><input type="hidden" name="id" value={v.id} /><input type="hidden" name="active" value={v.active ? "0" : "1"} /><SubmitButton className="linkbtn">{v.active ? "Retire" : "Use again"}</SubmitButton></form></div>
            </li>
          ))}</ul>
        )}
        <p className="muted">Vehicles are never deleted, so past expenses always keep their vehicle.</p>
      </div>
      <p className="muted">Trips and the mileage deduction stay on <Link href="/mileage">Mileage</Link>; nothing there has changed.</p>
    </main>
  );
}
