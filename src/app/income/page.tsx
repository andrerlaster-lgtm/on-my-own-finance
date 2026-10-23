import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, listIncome, addIncome, deleteManualIncome } from "@/lib/db";
import { MANUAL_SOURCES, SOURCE_LABELS, TAX_FORMS, parseIncomeForm } from "@/lib/income";
import { formatCents } from "@/lib/money";
import { addDays, todayInChicago } from "@/lib/dates";
import { Nav } from "@/components/Nav";

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

async function remove(form: FormData) {
  "use server";
  await requireOwner();
  const id = Number(form.get("id"));
  if (Number.isInteger(id) && id > 0) await deleteManualIncome(id);
  redirect("/income");
}

export default async function Income({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const sp = await searchParams;
  const today = todayInChicago();
  const rows = await listIncome(addDays(today, -400), addDays(today, 31), 200);
  return (
    <main>
      <Nav />
      <h1>Income</h1>
      <div className="note">Revenue here excludes tips and excludes refunds. Tips are kept in their own column so nothing is counted twice. Which 1099 form applies is a separate choice from where the money came from; ask your tax preparer.</div>
      {sp.saved && <div className="note">Saved.</div>}
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      <form action={add} className="card">
        <h2>Add income</h2>
        <label htmlFor="d">Date</label><input id="d" name="occurred_on" type="date" defaultValue={today} required />
        <label htmlFor="s">Where it came from</label>
        <select id="s" name="source">{MANUAL_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <label htmlFor="t">Tax form (separate from the source)</label>
        <select id="t" name="tax_form" defaultValue="unknown">{TAX_FORMS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
        <label htmlFor="g">Revenue, not including tips ($)</label><input id="g" name="gross" type="text" inputMode="decimal" placeholder="0.00" />
        <label htmlFor="tp">Tips ($)</label><input id="tp" name="tip" type="text" inputMode="decimal" placeholder="0.00" />
        <label htmlFor="f">Processing fee ($)</label><input id="f" name="fee" type="text" inputMode="decimal" placeholder="0.00" />
        <label htmlFor="v">Visits</label><input id="v" name="visits" type="number" min={0} max={1000} defaultValue={1} />
        <p><button className="btn" type="submit">Add</button></p>
      </form>
      <div className="card tablewrap">
        <h2>Recent entries</h2>
        {rows.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <table>
            <thead><tr><th>Date</th><th>Source</th><th>Form</th><th className="num">Revenue</th><th className="num">Tips</th><th className="num">Fee</th><th className="num">Visits</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td>{r.occurred_on}</td><td>{SOURCE_LABELS[r.source] ?? r.source}</td><td>{TAX_FORMS.find((t) => t.id === r.tax_form)?.label.split(" (")[0]}</td>
                <td className="num">{formatCents(r.gross_cents)}</td><td className="num">{formatCents(r.tip_cents)}</td><td className="num">{formatCents(r.fee_cents)}</td><td className="num">{r.visits}</td>
                <td>{r.imported ? <span className="muted">imported</span> : <form action={remove} className="inline"><input type="hidden" name="id" value={r.id} /><button className="linkbtn" type="submit">Delete</button></form>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </main>
  );
}
