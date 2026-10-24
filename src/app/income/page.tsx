import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, listIncome, addIncome, deleteManualIncome, setVisits, listPayers } from "@/lib/db";
import { MANUAL_SOURCES, SOURCE_LABELS, TAX_FORMS, parseIncomeForm, parseVisits } from "@/lib/income";
import { formatCents } from "@/lib/money";
import { addDays, todayInChicago } from "@/lib/dates";
import { Nav } from "@/components/Nav";
import { rowsToShow } from "@/lib/paging";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

async function add(form: FormData) {
  "use server";
  await requireOwner();
  const raw: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") raw[k] = v;
  const parsed = parseIncomeForm(raw);
  if (!parsed.ok) redirect(`/income?error=${encodeURIComponent(parsed.errors.join(" | "))}`);
  await addIncome(parsed.value);
  redirect("/income?saved=1");
}

async function saveVisits(form: FormData) {
  "use server";
  await requireOwner();
  const id = Number(form.get("id")), visits = parseVisits(String(form.get("visits") ?? ""));
  if (!Number.isInteger(id) || id < 1) redirect("/income");
  if (visits === null) redirect(`/income?error=${encodeURIComponent("Visits: a whole number from 0 to 1000, or leave empty.")}`);
  await setVisits(id, visits);
  redirect("/income?saved=1");
}

async function remove(form: FormData) {
  "use server";
  await requireOwner();
  const id = Number(form.get("id"));
  if (Number.isInteger(id) && id > 0) await deleteManualIncome(id);
  redirect("/income");
}

export default async function Income({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; rows?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const sp = await searchParams;
  const today = todayInChicago();
  const payers = await listPayers();
  const rows = await listIncome(addDays(today, -400), addDays(today, 31), rowsToShow(sp.rows) + 1);
  return (
    <main>
      <Nav />
      <h1>Income</h1>
      <p><Link className="btn secondary" href="/income/import">Import Square CSV</Link></p>
      <div className="note">Revenue here excludes tips and excludes refunds. Tips are kept in their own column so nothing is counted twice. Which 1099 form applies is a separate choice from where the money came from; ask your tax preparer.</div>
      {sp.saved && <div className="note">Saved.</div>}
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      <form action={add} className="card">
        <h2>Add income</h2>
        <label htmlFor="d">Date</label><input id="d" name="occurred_on" type="date" defaultValue={today} required />
        <label htmlFor="s">Where it came from</label>
        <select id="s" name="source">{MANUAL_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <label htmlFor="pa">Payer (optional; add payers under Taxes)</label>
        <select id="pa" name="payer_id" defaultValue=""><option value="">(none)</option>{payers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        <label htmlFor="t">Tax form (separate from the source)</label>
        <select id="t" name="tax_form" defaultValue="unknown">{TAX_FORMS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
        <label htmlFor="g">Revenue, not including tips ($)</label><input id="g" name="gross" type="text" inputMode="decimal" placeholder="0.00" />
        <label htmlFor="tp">Tips ($)</label><input id="tp" name="tip" type="text" inputMode="decimal" placeholder="0.00" />
        <label htmlFor="f">Processing fee ($)</label><input id="f" name="fee" type="text" inputMode="decimal" placeholder="0.00" />
        <label htmlFor="v">Visits (optional)</label><input id="v" name="visits" type="number" min={0} max={1000} placeholder="not entered" />
        <p><SubmitButton className="btn">Add</SubmitButton></p>
      </form>
      <div className="card tablewrap">
        <h2>Recent entries</h2>
        {rows.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <table>
            <thead><tr><th>Date</th><th>Source</th><th>Form</th><th>Payer</th><th className="num">Revenue</th><th className="num">Tips</th><th className="num">Fee</th><th className="num">Visits</th><th /></tr></thead>
            <tbody>{rows.slice(0, rowsToShow(sp.rows)).map((r) => (
              <tr key={r.id}>
                <td>{r.occurred_on}</td><td>{SOURCE_LABELS[r.source] ?? r.source}</td><td>{TAX_FORMS.find((t) => t.id === r.tax_form)?.label.split(" (")[0]}</td><td>{payers.find((p) => p.id === r.payer_id)?.label ?? ""}</td>
                <td className="num">{formatCents(r.gross_cents)}</td><td className="num">{formatCents(r.tip_cents)}</td><td className="num">{formatCents(r.fee_cents)}</td><td className="num"><form action={saveVisits} className="inline"><input type="hidden" name="id" value={r.id} /><input name="visits" type="number" min={0} max={1000} defaultValue={r.visits || ""} placeholder="–" aria-label="Visits" style={{ width: 64 }} /> <SubmitButton className="linkbtn">Save</SubmitButton></form></td>
                <td>{r.imported ? <span className="muted">imported</span> : <form action={remove} className="inline"><input type="hidden" name="id" value={r.id} /><SubmitButton className="linkbtn">Delete</SubmitButton></form>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {rows.length > rowsToShow(sp.rows) && <p><Link href={`/income?rows=${rowsToShow(sp.rows) + 100}`}>Show 100 more</Link></p>}
      </div>
    </main>
  );
}
