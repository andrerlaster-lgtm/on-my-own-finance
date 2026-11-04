import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, schemaVersion, listVehicles, listMaintenance, latestOdometers, addPlannedMaintenance, saveService, deleteMaintenance } from "@/lib/db";
import { VEHICLE_CATEGORIES, dueStatus, parsePlannedForm, parseServiceForm, plannedEstimateTotal } from "@/lib/vehicles";
import { readPhoto } from "@/lib/formPhoto";
import { formatCents } from "@/lib/money";
import { todayInChicago } from "@/lib/dates";
import { ReceiptPicker } from "@/components/ReceiptPicker";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";
const fail = (msg: string): never => redirect(`/vehicles/maintenance?error=${encodeURIComponent(msg)}`);
const raw = (fd: FormData) => { const o: Record<string, string> = {}; for (const [k, v] of fd.entries()) if (typeof v === "string") o[k] = v; return o; };

async function plan(fd: FormData) {
  "use server";
  await requireOwner();
  const parsed = parsePlannedForm(raw(fd));
  if (!parsed.ok) return fail(parsed.errors.join(" | "));
  try { await addPlannedMaintenance(parsed.value); } catch { return fail("Vehicle not found."); }
  redirect("/vehicles/maintenance?saved=1");
}
async function finish(fd: FormData) {
  "use server";
  await requireOwner();
  const parsed = parseServiceForm(raw(fd), true);
  if (!parsed.ok) return fail(parsed.errors.join(" | "));
  const photo = await readPhoto(fd);
  if (photo && "error" in photo) return fail(photo.error);
  if (photo && !parsed.value.cost) return fail("A receipt photo needs the amount paid.");
  try { await saveService(parsed.value, photo?.bytes); } catch (e) { return fail(e instanceof Error ? e.message : "Could not save. Try again."); }
  redirect("/vehicles/maintenance?saved=1");
}
async function logDone(fd: FormData) {
  "use server";
  await requireOwner();
  const parsed = parseServiceForm(raw(fd), false);
  if (!parsed.ok) return fail(parsed.errors.join(" | "));
  const photo = await readPhoto(fd);
  if (photo && "error" in photo) return fail(photo.error);
  if (photo && !parsed.value.cost) return fail("A receipt photo needs the amount paid.");
  try { await saveService(parsed.value, photo?.bytes); } catch (e) { return fail(e instanceof Error ? e.message : "Could not save. Try again."); }
  redirect("/vehicles/maintenance?saved=1");
}
async function remove(fd: FormData) {
  "use server";
  await requireOwner();
  const id = Number(fd.get("id"));
  if (Number.isInteger(id) && id > 0) await deleteMaintenance(id);
  redirect("/vehicles/maintenance");
}

const STATUS_TEXT = { overdue: "Overdue", due_soon: "Due soon", upcoming: "Upcoming" } as const;

export default async function Maintenance({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  if (((await schemaVersion()) ?? 0) < 11) redirect("/vehicles");
  const sp = await searchParams;
  const today = todayInChicago();
  const [vehicles, items, odos] = await Promise.all([listVehicles(), listMaintenance(), latestOdometers()]);
  const label = (id: number) => vehicles.find((v) => v.id === id)?.label ?? `Vehicle ${id}`;
  const active = vehicles.filter((v) => v.active);
  const planned = items.filter((i) => i.status === "planned"), done = items.filter((i) => i.status === "done");
  const costFields = (id: string) => (<>
    <label htmlFor={`a${id}`}>Amount paid ($, leave empty if nothing was paid)</label><input id={`a${id}`} name="amount" type="text" inputMode="decimal" placeholder="0.00" />
    <label htmlFor={`c${id}`}>Category (if paid)</label>
    <select id={`c${id}`} name="vehicle_category" defaultValue="maintenance">{VEHICLE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
    <label htmlFor={`v${id}`}>Vendor (optional)</label><input id={`v${id}`} name="vendor" type="text" maxLength={60} />
    <label className="check"><input type="checkbox" name="receipt_on_file" /> I kept the receipt</label>
    <label>Receipt photo</label><ReceiptPicker />
  </>);
  return (
    <main>
      <p><Link href="/vehicles">← Vehicles</Link></p>
      <h1>Maintenance log</h1>
      <div className="note">Upcoming items and their estimates are reminders only: they are <b>not</b> in the books. When you mark one done and enter the amount you actually paid, that amount is recorded once as a vehicle expense. Do not put patient information here.</div>
      {sp.saved && <div className="note">Saved.</div>}
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      {active.length === 0 ? <div className="card">Add a vehicle first on the <Link href="/vehicles">Vehicles</Link> page.</div> : (<>
        <div className="card">
          <h2>Upcoming ({planned.length}) <span className="muted">estimated total {formatCents(plannedEstimateTotal(planned))}, not in the books</span></h2>
          {planned.length === 0 ? <p className="muted">Nothing planned.</p> : (
            <ul className="entries">{planned.map((i) => { const st = dueStatus(i, today, odos.get(i.vehicle_id) ?? null); return (
              <li className="entry" key={i.id}>
                <span className="what">{i.title}</span>
                <span className="amt">{i.estimated_cost_cents === null ? "no estimate" : `~${formatCents(i.estimated_cost_cents)}`}</span>
                <span className="meta"><b>{STATUS_TEXT[st]}</b> · {label(i.vehicle_id)}{i.due_on ? ` · due ${i.due_on}` : ""}{i.due_odometer !== null ? ` · due at ${i.due_odometer.toLocaleString("en-US")} mi` : ""}{odos.get(i.vehicle_id) ? ` · last odometer ${odos.get(i.vehicle_id)!.toLocaleString("en-US")}` : ""}</span>
                <div className="acts">
                  <details className="mini"><summary>Mark done</summary>
                    <form action={finish}><input type="hidden" name="maintenance_id" value={i.id} />
                      <label htmlFor={`d${i.id}`}>Date done</label><input id={`d${i.id}`} name="done_on" type="date" defaultValue={today} required />
                      <label htmlFor={`o${i.id}`}>Odometer (optional)</label><input id={`o${i.id}`} name="odometer" type="text" inputMode="numeric" />
                      {costFields(`p${i.id}`)}
                      <SubmitButton className="btn">Save as done</SubmitButton></form>
                  </details>
                  <form action={remove} className="inline"><input type="hidden" name="id" value={i.id} /><SubmitButton className="linkbtn">Delete</SubmitButton></form>
                </div>
              </li>); })}</ul>
          )}
        </div>
        <form action={plan} className="card">
          <h2>Plan upcoming maintenance</h2>
          <label htmlFor="pv">Vehicle</label><select id="pv" name="vehicle_id" defaultValue={active[0].id}>{active.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
          <label htmlFor="pt">What is due (like “Oil change”)</label><input id="pt" name="title" type="text" maxLength={60} required />
          <label htmlFor="pd">Due date (optional)</label><input id="pd" name="due_on" type="date" />
          <label htmlFor="po">Or due at odometer (optional)</label><input id="po" name="due_odometer" type="text" inputMode="numeric" placeholder="miles" />
          <label htmlFor="pe">Estimated cost ($, optional)</label><input id="pe" name="estimate" type="text" inputMode="decimal" placeholder="0.00" />
          <p className="muted">Give a due date, an odometer reading, or both.</p>
          <p><SubmitButton className="btn">Save reminder</SubmitButton></p>
        </form>
        <form action={logDone} className="card">
          <h2>Log a completed repair or service</h2>
          <label htmlFor="lv">Vehicle</label><select id="lv" name="vehicle_id" defaultValue={active[0].id}>{active.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
          <label htmlFor="lt">What was done</label><input id="lt" name="title" type="text" maxLength={60} required />
          <label htmlFor="ld">Date done</label><input id="ld" name="done_on" type="date" defaultValue={today} required />
          <label htmlFor="lo">Odometer (optional)</label><input id="lo" name="odometer" type="text" inputMode="numeric" />
          {costFields("new")}
          <p><SubmitButton className="btn">Save to the log</SubmitButton></p>
        </form>
      </>)}
      <div className="card">
        <h2>Completed ({done.length})</h2>
        {done.length === 0 ? <p className="muted">Nothing logged yet.</p> : (
          <ul className="entries">{done.map((i) => (
            <li className="entry" key={i.id}>
              <span className="what">{i.title}</span>
              <span className="amt">{i.paid_cents === null ? "no cost recorded" : formatCents(i.paid_cents)}</span>
              <span className="meta">{i.done_on} · {label(i.vehicle_id)}{i.odometer_at !== null ? ` · odometer ${i.odometer_at.toLocaleString("en-US")}` : ""}{i.expense_id !== null ? " · paid (see Vehicle expenses)" : ""}</span>
              <div className="acts"><form action={remove} className="inline"><input type="hidden" name="id" value={i.id} /><SubmitButton className="linkbtn">Delete log line</SubmitButton></form></div>
            </li>))}</ul>
        )}
        <p className="muted">Deleting a log line never deletes a paid expense. Delete the expense itself on <Link href="/vehicles/expenses">Vehicle expenses</Link>.</p>
      </div>
    </main>
  );
}
