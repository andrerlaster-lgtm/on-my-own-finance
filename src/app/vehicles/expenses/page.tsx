import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, schemaVersion, listVehicles, listVehicleExpenses, addVehicleExpense, deleteExpense, addReceipt, countReceipts, receiptIdsFor, deleteReceipt } from "@/lib/db";
import { VEHICLE_CATEGORIES, VEHICLE_CATEGORY_LABELS, parseVehicleExpenseForm } from "@/lib/vehicles";
import { MAX_RECEIPTS_PER_EXPENSE } from "@/lib/receipts";
import { readPhoto } from "@/lib/formPhoto";
import { formatCents } from "@/lib/money";
import { periodRanges, todayInChicago } from "@/lib/dates";
import { rowsToShow } from "@/lib/paging";
import { ReceiptPicker } from "@/components/ReceiptPicker";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";
const fail = (msg: string): never => redirect(`/vehicles/expenses?error=${encodeURIComponent(msg)}`);

async function add(fd: FormData) {
  "use server";
  await requireOwner();
  const raw: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") raw[k] = v;
  const parsed = parseVehicleExpenseForm(raw);
  if (!parsed.ok) return fail(parsed.errors.join(" | "));
  const photo = await readPhoto(fd);
  if (photo && "error" in photo) return fail(photo.error);
  try { await addVehicleExpense(parsed.value, photo?.bytes); } catch (e) { return fail(e instanceof Error && e.message === "Vehicle not found." ? e.message : "Could not save. Try again."); }
  redirect("/vehicles/expenses?saved=1");
}
async function addPhoto(fd: FormData) {
  "use server";
  await requireOwner();
  const id = /^\d{1,12}$/.test(String(fd.get("expense_id") ?? "")) ? Number(fd.get("expense_id")) : 0;
  if (!id || (await countReceipts(id)) >= MAX_RECEIPTS_PER_EXPENSE) return fail(`At most ${MAX_RECEIPTS_PER_EXPENSE} photos per expense.`);
  const photo = await readPhoto(fd);
  if (!photo) return fail("Choose a photo first.");
  if ("error" in photo) return fail(photo.error);
  await addReceipt(id, photo.bytes);
  redirect("/vehicles/expenses?saved=1");
}
async function removePhoto(fd: FormData) {
  "use server";
  await requireOwner();
  const id = Number(fd.get("id"));
  if (Number.isInteger(id) && id > 0) await deleteReceipt(id);
  redirect("/vehicles/expenses");
}
async function remove(fd: FormData) {
  "use server";
  await requireOwner();
  const id = Number(fd.get("id"));
  if (Number.isInteger(id) && id > 0) await deleteExpense(id);
  redirect("/vehicles/expenses");
}

export default async function VehicleExpenses({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; rows?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  if (((await schemaVersion()) ?? 0) < 10) redirect("/vehicles");
  const sp = await searchParams;
  const today = todayInChicago(), p = periodRanges(today);
  const [vehicles, list] = await Promise.all([listVehicles(), listVehicleExpenses(p.year.from, p.year.to, 50_001)]);
  if (list.length > 50_000) throw new Error("Too many vehicle expenses to show at once.");
  const shown = rowsToShow(sp.rows), photoIds = await receiptIdsFor(list.slice(0, shown).filter((e) => e.photos > 0).map((e) => e.id));
  const label = (id: number) => vehicles.find((v) => v.id === id)?.label ?? `Vehicle ${id}`;
  const active = vehicles.filter((v) => v.active);
  return (
    <main>
      <p><Link href="/vehicles">← Vehicles</Link></p>
      <h1>Vehicle expenses</h1>
      <div className="note">Enter what you actually paid. It goes in the books once, on the date you enter. It is not claimed on taxes automatically: see Vehicles for how the year is treated. Do not put patient information in any field or photo.</div>
      {sp.saved && <div className="note">Saved.</div>}
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      {active.length === 0 ? <div className="card">Add a vehicle first on the <Link href="/vehicles">Vehicles</Link> page.</div> : (
        <form action={add} className="card">
          <h2>Add a vehicle expense</h2>
          <label htmlFor="ve">Vehicle</label>
          <select id="ve" name="vehicle_id" defaultValue={active[0].id}>{active.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
          <label htmlFor="vd">Date paid</label><input id="vd" name="spent_on" type="date" defaultValue={today} required />
          <label htmlFor="va">Amount ($)</label><input id="va" name="amount" type="text" inputMode="decimal" placeholder="0.00" required />
          <label htmlFor="vc">Category</label>
          <select id="vc" name="vehicle_category" defaultValue="fuel">{VEHICLE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          <label htmlFor="vv">Vendor (business name only, optional)</label><input id="vv" name="vendor" type="text" maxLength={60} />
          <label htmlFor="vo">Odometer (optional)</label><input id="vo" name="odometer" type="text" inputMode="numeric" placeholder="miles" />
          <label className="check"><input type="checkbox" name="receipt_on_file" /> I kept the paper or digital receipt</label>
          <label>Receipt photo</label><ReceiptPicker />
          <p><SubmitButton className="btn">Add expense</SubmitButton></p>
        </form>
      )}
      <div className="card">
        <h2>This year ({list.length})</h2>
        {list.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <ul className="entries">{list.slice(0, shown).map((e) => { const ids = photoIds.get(e.id) ?? []; return (
            <li className="entry" key={e.id}>
              <span className="what">{e.vendor ?? VEHICLE_CATEGORY_LABELS[e.vehicle_category]}</span>
              <span className="amt">{formatCents(e.amount_cents)}</span>
              <span className="meta">{e.spent_on} · {label(e.vehicle_id)} · {VEHICLE_CATEGORY_LABELS[e.vehicle_category]}{e.odometer !== null ? ` · odometer ${e.odometer.toLocaleString("en-US")}` : ""}{e.receipt_on_file ? " · receipt kept" : ""}{ids.length ? ` · ${ids.length} photo${ids.length === 1 ? "" : "s"}` : ""}</span>
              <div className="acts">
                {ids.map((id, i) => (<span key={id}><a href={`/api/receipts/${id}`} target="_blank" rel="noreferrer">Photo {i + 1}</a>
                  <form action={removePhoto} className="inline"><input type="hidden" name="id" value={id} /><SubmitButton className="linkbtn">remove</SubmitButton></form></span>))}
                {ids.length < MAX_RECEIPTS_PER_EXPENSE && (<details className="mini"><summary>Add photo</summary>
                  <form action={addPhoto}><input type="hidden" name="expense_id" value={e.id} /><ReceiptPicker /><SubmitButton className="btn secondary">Save photo</SubmitButton></form></details>)}
                <form action={remove} className="inline"><input type="hidden" name="id" value={e.id} /><SubmitButton className="linkbtn">Delete</SubmitButton></form>
              </div>
            </li>); })}</ul>
        )}
        {list.length > shown && <p><Link href={`/vehicles/expenses?rows=${shown + 200}`}>Show 200 more ({list.length - shown} older)</Link></p>}
      </div>
    </main>
  );
}
