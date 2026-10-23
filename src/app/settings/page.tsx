import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, getRules, saveRules } from "@/lib/db";
import { RULE_FIELDS, SALES_TAX_OPTIONS, needsConfirmation, parseRulesForm, parseYear } from "@/lib/taxRules";

export const dynamic = "force-dynamic";

async function save(form: FormData) {
  "use server";
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const raw: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") raw[k] = v;
  const parsed = parseRulesForm(raw);
  const year = parseYear(raw.tax_year) ?? new Date().getFullYear();
  if (!parsed.ok) redirect(`/settings?year=${year}&error=${encodeURIComponent(parsed.errors.join(" | "))}`);
  await saveRules(parsed.rules);
  redirect(`/settings?year=${year}&saved=1`);
}

export default async function Settings({ searchParams }: { searchParams: Promise<{ year?: string; error?: string; saved?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const sp = await searchParams;
  const year = parseYear(sp.year) ?? new Date().getFullYear();
  const rules = await getRules(year);
  const pending = needsConfirmation(rules);
  const r = rules as unknown as Record<string, unknown>;
  return (
    <main>
      <p><Link href="/">← Home</Link></p>
      <h1>Tax-year rules</h1>
      <form method="get" className="card row">
        <label htmlFor="y" style={{ margin: 0 }}>Tax year</label>
        <input id="y" name="year" type="number" min={2000} max={2100} defaultValue={year} style={{ maxWidth: 120 }} />
        <button className="btn secondary" type="submit">Show</button>
      </form>
      {sp.saved && <div className="note">Saved.</div>}
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      <div className="card">
        <h2>Still to confirm with the preparer</h2>
        {pending.length ? <ul className="plain">{pending.map((p) => <li key={p}>{p}</li>)}</ul> : <p>Everything for {year} is confirmed.</p>}
      </div>
      <form action={save} className="card">
        <input type="hidden" name="tax_year" value={year} />
        {RULE_FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={f.key}>{f.label}</label>
            <input id={f.key} name={f.key} type="number" inputMode="decimal" step={f.step} min={f.min} max={f.max} defaultValue={(r[f.key] as number | null) ?? ""} placeholder="not set" />
            <div className="muted">{f.hint}</div>
            <label className="check"><input type="checkbox" name={f.confirmKey} defaultChecked={Boolean(r[f.confirmKey])} /> Confirmed with my tax preparer</label>
          </div>
        ))}
        <label htmlFor="sales_tax">Sales tax</label>
        <select id="sales_tax" name="sales_tax" defaultValue={rules.sales_tax}>
          {SALES_TAX_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <label className="check"><input type="checkbox" name="sales_tax_confirmed" defaultChecked={rules.sales_tax_confirmed} /> Confirmed with my tax preparer</label>
        <p><button className="btn" type="submit">Save {year}</button></p>
      </form>
    </main>
  );
}
