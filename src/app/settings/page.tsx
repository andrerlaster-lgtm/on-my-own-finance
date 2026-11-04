import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, getRules, saveRules, schemaVersion } from "@/lib/db";
import { RULE_FIELDS, SALES_TAX_OPTIONS, applyPublished, needsConfirmation, parseRulesForm, parseYear, publishedFor } from "@/lib/taxRules";
import { SubmitButton } from "@/components/SubmitButton";

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
  try { await saveRules(parsed.rules); } catch (e) {
    redirect(`/settings?year=${year}&error=${encodeURIComponent(e instanceof Error && /database update/.test(e.message) ? e.message : "Could not save. Try again.")}`);
  }
  redirect(`/settings?year=${year}&saved=1`);
}

/** Copies the published figures into empty fields only. Nothing is overwritten and nothing is marked confirmed. */
async function fillPublished(form: FormData) {
  "use server";
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const year = parseYear(String(form.get("tax_year") ?? "")) ?? new Date().getFullYear();
  const pub = publishedFor(year);
  if (!pub) redirect(`/settings?year=${year}`);
  if (pub.mileage_rate_h2_cents && ((await schemaVersion()) ?? 0) < 6) redirect(`/settings?year=${year}&error=${encodeURIComponent("Update the database first (the Update button on the home page), then fill in the published figures.")}`);
  const { rules, filled } = applyPublished(await getRules(year));
  if (filled.length) await saveRules(rules);
  redirect(`/settings?year=${year}&filled=${filled.length}`);
}

export default async function Settings({ searchParams }: { searchParams: Promise<{ year?: string; error?: string; saved?: string; filled?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const sp = await searchParams;
  const year = parseYear(sp.year) ?? new Date().getFullYear();
  const rules = await getRules(year);
  const pending = needsConfirmation(rules);
  const r = rules as unknown as Record<string, unknown>;
  const published = publishedFor(year);
  return (
    <main>
      <p><Link href="/">← Home</Link></p>
      <h1>Tax-year rules</h1>
      <form method="get" className="card row">
        <label htmlFor="y" style={{ margin: 0 }}>Tax year</label>
        <input id="y" name="year" type="number" min={2000} max={2100} defaultValue={year} style={{ maxWidth: 120 }} />
        <SubmitButton className="btn secondary">Show</SubmitButton>
      </form>
      {sp.saved && <div className="note">Saved.</div>}
      {sp.filled !== undefined && <div className="note">{Number(sp.filled) > 0 ? `Filled in ${Number(sp.filled)} empty ${Number(sp.filled) === 1 ? "field" : "fields"} with the published figures. They are not confirmed yet.` : "Nothing to fill in: every published figure already has a value."}</div>}
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      <div className="card">
        <h2>Still to confirm with the preparer</h2>
        {pending.length ? <ul className="plain">{pending.map((p) => <li key={p}>{p}</li>)}</ul> : <p>Everything for {year} is confirmed.</p>}
      </div>
      {published && (
        <div className="card">
          <h2>Published {year} figures</h2>
          <p className="muted">Looked up from the IRS and the 2025 tax law. The app only fills empty fields, never changes a value you entered, and leaves &ldquo;confirmed with my tax preparer&rdquo; unchecked. The set-aside percent is not published; your preparer sets it.</p>
          <ul className="plain">
            {RULE_FIELDS.map((f) => { const fig = published[f.key]; return fig ? (
              <li key={f.key}><b>{f.label}: {fig.value}</b><div className="muted">{fig.note} Source: {fig.source}.</div></li>
            ) : null; })}
          </ul>
          <p className="muted">Check these against irs.gov or with your preparer before relying on them.</p>
          <form action={fillPublished}><input type="hidden" name="tax_year" value={year} /><SubmitButton className="btn secondary">Fill in the empty fields</SubmitButton></form>
        </div>
      )}
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
        <p><SubmitButton className="btn">Save {year}</SubmitButton></p>
      </form>
    </main>
  );
}
