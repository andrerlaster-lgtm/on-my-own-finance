import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, listExpensesAll, addExpense, deleteExpense, addReceipt, countReceipts, expenseExists, receiptIdsFor, deleteReceipt, inventoryPurchasesTotal } from "@/lib/db";
import { CATEGORIES, CATEGORY_LABELS, parseExpenseForm, summarizeExpenses } from "@/lib/expenses";
import { MAX_RECEIPTS_PER_EXPENSE, MAX_RECEIPT_BYTES, inspectJpeg } from "@/lib/receipts";
import { formatCents } from "@/lib/money";
import { periodRanges, todayInChicago } from "@/lib/dates";
import { rowsToShow } from "@/lib/paging";
import Link from "next/link";
import { ReceiptPicker } from "@/components/ReceiptPicker";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";
const fail = (msg: string): never => redirect(`/expenses?error=${encodeURIComponent(msg)}`);

/** null = no photo chosen. Otherwise the server re-checks the photo itself: plain JPEG, small, no hidden metadata. */
async function readPhoto(fd: FormData): Promise<null | { bytes: Uint8Array } | { error: string }> {
  const f = fd.get("receipt");
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > MAX_RECEIPT_BYTES) return { error: "The photo is larger than 1.5 MB." };
  const bytes = new Uint8Array(await f.arrayBuffer());
  const c = inspectJpeg(bytes);
  return c.ok ? { bytes } : { error: c.error };
}

async function add(fd: FormData) {
  "use server";
  await requireOwner();
  const raw: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") raw[k] = v;
  const parsed = parseExpenseForm(raw);
  if (!parsed.ok) return fail(parsed.errors.join(" | "));
  const photo = await readPhoto(fd);
  if (photo && "error" in photo) return fail(photo.error);
  await addExpense(parsed.value, photo?.bytes);
  redirect("/expenses?saved=1");
}

async function addPhoto(fd: FormData) {
  "use server";
  await requireOwner();
  const id = /^\d{1,12}$/.test(String(fd.get("expense_id") ?? "")) ? Number(fd.get("expense_id")) : 0;
  if (!id || !(await expenseExists(id))) return fail("Expense not found.");
  if ((await countReceipts(id)) >= MAX_RECEIPTS_PER_EXPENSE) return fail(`At most ${MAX_RECEIPTS_PER_EXPENSE} photos per expense.`);
  const photo = await readPhoto(fd);
  if (!photo) return fail("Choose a photo first.");
  if ("error" in photo) return fail(photo.error);
  await addReceipt(id, photo.bytes);
  redirect("/expenses?saved=1");
}

async function removePhoto(fd: FormData) {
  "use server";
  await requireOwner();
  const id = Number(fd.get("id"));
  if (Number.isInteger(id) && id > 0) await deleteReceipt(id);
  redirect("/expenses");
}

async function remove(fd: FormData) {
  "use server";
  await requireOwner();
  const id = Number(fd.get("id"));
  if (Number.isInteger(id) && id > 0) await deleteExpense(id);
  redirect("/expenses");
}

export default async function Expenses({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; rows?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const sp = await searchParams;
  const today = todayInChicago();
  const p = periodRanges(today);
  const list = await listExpensesAll(p.year.from, p.year.to);
  const shown = rowsToShow(sp.rows), photoIds = await receiptIdsFor(list.slice(0, shown).filter((e) => e.photos > 0).map((e) => e.id));
  const withPhotos = list.slice(0, shown).map((e) => ({ e, ids: photoIds.get(e.id) ?? [] }));
  const month = summarizeExpenses(list, p.month), year = summarizeExpenses(list, p.year);
  const invMonth = await inventoryPurchasesTotal(p.month.from, p.month.to), invYear = await inventoryPurchasesTotal(p.year.from, p.year.to);
  return (
    <main>
      <h1>Expenses</h1>
      <div className="note">Enter supply purchases here too: the inventory ledger does not create expenses. Do not enter Square processing fees; they are already saved on each imported payment. Do not put patient information in any field or photo.</div>
      {sp.saved && <div className="note">Saved.</div>}
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      <div className="card grid2">
        <div className="stat">This month<b>{formatCents(month.total)}</b></div>
        <div className="stat">This year<b>{formatCents(year.total)}</b></div>
        <div className="stat">Inventory purchases this month (not counted above)<b>{formatCents(invMonth)}</b></div>
        <div className="stat">Inventory purchases this year (not counted above)<b>{formatCents(invYear)}</b></div>
      </div>
      <form action={add} className="card">
        <h2>Add an expense</h2>
        <label htmlFor="d">Date</label><input id="d" name="spent_on" type="date" defaultValue={today} required />
        <label htmlFor="a">Amount ($)</label><input id="a" name="amount" type="text" inputMode="decimal" placeholder="0.00" required />
        <label htmlFor="c">Category</label>
        <select id="c" name="category" defaultValue="supplies">{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        <label htmlFor="v">Vendor (business name only, optional)</label><input id="v" name="vendor" type="text" maxLength={60} />
        <label className="check"><input type="checkbox" name="receipt_on_file" /> I kept the paper or digital receipt</label>
        <label>Receipt photo</label><ReceiptPicker />
        <p><SubmitButton className="btn">Add expense</SubmitButton></p>
      </form>
      <div className="card">
        <h2>This year ({list.length})</h2>
        {withPhotos.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <ul className="entries">{withPhotos.map(({ e, ids }) => (
            <li className="entry" key={e.id}>
              <span className="what">{e.vendor ?? CATEGORY_LABELS[e.category]}</span>
              <span className="amt">{formatCents(e.amount_cents)}</span>
              <span className="meta">{e.spent_on} · {CATEGORY_LABELS[e.category]}{e.receipt_on_file ? " · receipt kept" : ""}{ids.length ? ` · ${ids.length} photo${ids.length === 1 ? "" : "s"}` : ""}</span>
              <div className="acts">
                {ids.map((id, i) => (
                  <span key={id}><a href={`/api/receipts/${id}`} target="_blank" rel="noreferrer">Photo {i + 1}</a>
                    <form action={removePhoto} className="inline"><input type="hidden" name="id" value={id} /><SubmitButton className="linkbtn">remove</SubmitButton></form></span>
                ))}
                {ids.length < MAX_RECEIPTS_PER_EXPENSE && (
                  <details className="mini"><summary>Add photo</summary>
                    <form action={addPhoto}><input type="hidden" name="expense_id" value={e.id} /><ReceiptPicker /><SubmitButton className="btn secondary">Save photo</SubmitButton></form>
                  </details>
                )}
                <form action={remove} className="inline"><input type="hidden" name="id" value={e.id} /><SubmitButton className="linkbtn">Delete</SubmitButton></form>
              </div>
            </li>
          ))}</ul>
        )}
        {list.length > shown && <p><Link href={`/expenses?rows=${shown + 200}`}>Show 200 more ({list.length - shown} older)</Link></p>}
      </div>
    </main>
  );
}
