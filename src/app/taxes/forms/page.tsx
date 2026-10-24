import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, listForms, addForm, deleteForm, listPayers, addPayer } from "@/lib/db";
import { FORM_LABELS, FORM_TYPES, parseFormEntry, parsePayerForm } from "@/lib/taxforms";
import { formatCents } from "@/lib/money";
import { todayInChicago } from "@/lib/dates";
import { parseYear } from "@/lib/taxRules";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";
const to = (year: number | string, q: string) => redirect(`/taxes/forms?year=${year}&${q}`);
const read = (fd: FormData) => { const o: Record<string, string> = {}; for (const [k, v] of fd.entries()) if (typeof v === "string") o[k] = v; return o; };

async function addPayerAction(fd: FormData) {
  "use server";
  await requireOwner();
  const raw = read(fd), year = parseYear(raw.year) ?? todayInChicago().slice(0, 4);
  const p = parsePayerForm(raw);
  if (!p.ok) return to(year, `error=${encodeURIComponent(p.errors.join(" | "))}`);
  const r = await addPayer(p.value.label);
  return to(year, r.ok ? "saved=1" : `error=${encodeURIComponent(r.error)}`);
}

async function addFormAction(fd: FormData) {
  "use server";
  await requireOwner();
  const raw = read(fd), p = parseFormEntry(raw);
  const year = parseYear(raw.tax_year) ?? todayInChicago().slice(0, 4);
  if (!p.ok) return to(year, `error=${encodeURIComponent(p.errors.join(" | "))}`);
  await addForm(p.value);
  return to(p.value.tax_year, "saved=1");
}

async function removeForm(fd: FormData) {
  "use server";
  await requireOwner();
  const id = Number(fd.get("id")), year = parseYear(String(fd.get("year") ?? "")) ?? todayInChicago().slice(0, 4);
  if (Number.isInteger(id) && id > 0) await deleteForm(id);
  return to(year, "saved=1");
}

export default async function FormsPage({ searchParams }: { searchParams: Promise<{ year?: string; error?: string; saved?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const sp = await searchParams;
  const year = parseYear(sp.year) ?? Number(todayInChicago().slice(0, 4));
  const [forms, payers] = [await listForms(year), await listPayers()];
  return (
    <main>
      <Nav />
      <p><Link href={`/taxes?year=${year}`}>← Taxes {year}</Link></p>
      <h1>1099 forms and payers</h1>
      <div className="note">Enter the amount printed on each form you receive. Payers are business names only: no tax IDs, no personal details.</div>
      {sp.saved && <div className="note">Saved.</div>}
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      <form action={addPayerAction} className="card">
        <h2>Payers</h2>
        <input type="hidden" name="year" value={year} />
        <p className="muted">{payers.length ? payers.map((p) => p.label).join(", ") : "None yet."}</p>
        <label htmlFor="pl">Add a payer (the business that pays you)</label><input id="pl" name="label" type="text" maxLength={60} />
        <p><button className="btn secondary" type="submit">Add payer</button></p>
      </form>
      <form action={addFormAction} className="card">
        <h2>Add a form for {year}</h2>
        <input type="hidden" name="tax_year" value={year} />
        <label htmlFor="ft">Form</label><select id="ft" name="form_type">{FORM_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
        <label htmlFor="fp">Payer (needed for a 1099-NEC; leave empty for Square&rsquo;s 1099-K)</label>
        <select id="fp" name="payer_id" defaultValue=""><option value="">(none)</option>{payers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        <label htmlFor="fa">Amount on the form ($)</label><input id="fa" name="amount" type="text" inputMode="decimal" placeholder="0.00" />
        <p><button className="btn" type="submit">Add form</button></p>
      </form>
      <div className="card tablewrap">
        <h2>Forms entered for {year}</h2>
        {forms.length === 0 ? <p className="muted">None yet.</p> : (
          <table><thead><tr><th>Form</th><th>Payer</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>{forms.map((x) => (
              <tr key={x.id}><td>{FORM_LABELS[x.form_type]}</td><td>{payers.find((p) => p.id === x.payer_id)?.label ?? ""}</td><td className="num">{formatCents(x.amount_cents)}</td>
                <td><form action={removeForm} className="inline"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="year" value={year} /><button className="linkbtn" type="submit">Delete</button></form></td></tr>
            ))}</tbody></table>
        )}
      </div>
    </main>
  );
}
