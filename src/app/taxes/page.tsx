import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, loadPacketInput, saveSnapshot, listSnapshots } from "@/lib/db";
import { PACKET_SECTIONS, buildPacket } from "@/lib/packet";
import { FORM_LABELS } from "@/lib/taxforms";
import { formatCents } from "@/lib/money";
import { formatMiles } from "@/lib/mileage";
import { todayInChicago } from "@/lib/dates";
import { parseYear } from "@/lib/taxRules";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

async function snapshot(fd: FormData) {
  "use server";
  await requireOwner();
  const year = parseYear(String(fd.get("year") ?? ""));
  if (year === null) redirect("/taxes");
  await saveSnapshot(year, buildPacket(await loadPacketInput(year, todayInChicago())));
  redirect(`/taxes?year=${year}&saved=1`);
}

const LABELS: Record<string, string> = { summary: "Summary", receipts: "Receipts", expenses_by_category: "Expenses by category", expenses_detail: "Expenses (each)", income_detail: "Income (each)", mileage_detail: "Mileage (each)", form_reconciliation: "1099 reconciliation", tax_payments: "Tax payments" };

export default async function Taxes({ searchParams }: { searchParams: Promise<{ year?: string; saved?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const sp = await searchParams;
  const today = todayInChicago();
  const year = parseYear(sp.year) ?? Number(today.slice(0, 4));
  const k = buildPacket(await loadPacketInput(year, today));
  const snaps = await listSnapshots(year);
  const f = formatCents;
  const attention = k.readiness.filter((r) => r.level === "attention"), notes = k.readiness.filter((r) => r.level === "note");
  const th = (name: string, t: typeof k.forms.thresholdK) => t.status === "unset" ? `${name}: threshold not set` : t.status === "unconfirmed" ? `${name}: threshold set but not confirmed` : `${name}: ${f(t.receipts)} of ${f(t.thresholdCents ?? 0)} (${t.status === "reached" ? "reached" : "below"})`;
  return (
    <main>
      <Nav />
      <h1>Taxes {year}</h1>
      <div className="note">{k.caveats[0]} No tax is calculated here.</div>
      {sp.saved && <div className="note">Snapshot saved.</div>}
      <form method="get" className="card row">
        <label htmlFor="y" style={{ margin: 0 }}>Tax year</label>
        <input id="y" name="year" type="number" min={2000} max={2100} defaultValue={year} style={{ maxWidth: 120 }} />
        <button className="btn secondary" type="submit">Show</button>
        <Link className="btn secondary" href={`/taxes/forms?year=${year}`}>1099 forms and payers</Link>
        <Link className="btn secondary" href={`/taxes/payments?year=${year}`}>Tax payments</Link>
        <Link className="btn secondary" href={`/taxes/bulk?year=${year}`}>Set tax form on imports</Link>
        <Link className="btn secondary" href="/settings">Tax rules</Link>
      </form>
      <div className="card">
        <h2>Before you send this to your preparer</h2>
        {attention.length === 0 ? <p>Nothing needs attention.</p> : <ul className="plain">{attention.map((r) => <li key={r.text}>{r.text}</li>)}</ul>}
        {notes.length > 0 && <ul className="plain muted">{notes.map((r) => <li key={r.text}>{r.text}</li>)}</ul>}
      </div>
      <div className="card">
        <h2>Money in</h2>
        <div className="grid2">
          <div className="stat">Revenue (no tips, no refunds)<b>{f(k.receipts.total.revenue)}</b></div>
          <div className="stat">Tips<b>{f(k.receipts.total.tips)}</b></div>
          <div className="stat">Total receipts<b>{f(k.receipts.total.receipts)}</b></div>
          <div className="stat">Processing fees<b>{f(k.receipts.total.fees)}</b></div>
        </div>
        <div className="tablewrap"><table>
          <thead><tr><th>By tax form</th><th className="num">Entries</th><th className="num">Receipts</th></tr></thead>
          <tbody>{k.receipts.byForm.map((g) => <tr key={g.key}><td>{g.label}</td><td className="num">{g.count}</td><td className="num">{f(g.receipts)}</td></tr>)}</tbody>
          <thead><tr><th>By payer</th><th /><th /></tr></thead>
          <tbody>{k.receipts.byPayer.map((g) => <tr key={g.key}><td>{g.label}</td><td className="num">{g.count}</td><td className="num">{f(g.receipts)}</td></tr>)}</tbody>
        </table></div>
        <p className="muted">{th("1099-K", k.forms.thresholdK)} · {th("1099-NEC", k.forms.thresholdNec)}</p>
      </div>
      <div className="card">
        <h2>1099 forms vs the app</h2>
        {k.forms.rows.length === 0 && k.forms.unformed.length === 0 ? <p className="muted">No forms entered yet.</p> : (
          <ul className="plain">
            {k.forms.rows.map((r, i) => <li key={i}>{FORM_LABELS[r.form_type]}{r.payer_label ? ` from ${r.payer_label}` : ""}: form {f(r.formCents)}, app {f(r.appCents)} — {r.status === "match" ? "matches" : `difference ${f(r.diff)}`}</li>)}
            {k.forms.unformed.map((u, i) => <li key={`u${i}`}>{FORM_LABELS[u.form_type]}{u.payer_label ? ` from ${u.payer_label}` : ""}: app {f(u.appCents)}, no form entered</li>)}
          </ul>
        )}
        <p className="muted">A 1099-K counts payments including tips and before fees. The app leaves flagged Square refunds out, so small differences can be normal; your preparer decides.</p>
      </div>
      <div className="card">
        <h2>Profit and set-aside (estimates)</h2>
        <div className="grid2">
          <div className="stat">Net after processing fees<b>{f(k.profit.netAfterFees)}</b></div>
          <div className="stat">Expenses ({k.expenses.count})<b>{f(k.profit.expensesTotal)}</b></div>
          <div className="stat">Estimated profit, before taxes and mileage deduction<b>{k.profit.estimatedProfit === null ? "no expenses entered" : f(k.profit.estimatedProfit)}</b></div>
          <div className="stat">Mileage ({formatMiles(k.mileage.miles_tenths)} mi)<b>{k.mileage.deductionCents === null ? "rate not set" : f(k.mileage.deductionCents)}{k.mileage.deductionCents !== null && !k.mileage.confirmed ? " (not confirmed)" : ""}</b></div>
          <div className="stat">Set aside ({k.rules.set_aside_percent === null ? "no" : k.rules.set_aside_percent}%)<b>{k.setAside.amountCents === null ? (k.setAside.status === "percent_not_set" ? "percent not set" : k.setAside.status === "percent_not_confirmed" ? "percent not confirmed" : "no profit estimate") : f(k.setAside.amountCents)}</b></div>
          <div className="stat">Tax payments recorded<b>{f(k.setAside.paidCents)}</b></div>
          {k.setAside.remainingCents !== null && <div className="stat">Still to set aside<b>{f(k.setAside.remainingCents)}</b></div>}
        </div>
        <p className="muted">Inventory: {f(k.inventory.beginValue)} at the start, {f(k.inventory.purchasesValue)} bought, {f(k.inventory.usedValue)} used, {f(k.inventory.writeOffValue)} expired, {f(k.inventory.endValue)} at the end. <Link href="/inventory/report">Inventory report</Link></p>
      </div>
      <div className="card">
        <h2>Downloads for your preparer</h2>
        <ul className="plain">{PACKET_SECTIONS.map((s) => <li key={s}><a href={`/api/tax-packet?year=${year}&section=${s}`}>{LABELS[s]} (CSV)</a></li>)}<li><a href={`/api/inventory-report?year=${year}`}>Inventory (CSV)</a></li></ul>
        <form action={snapshot}>
          <input type="hidden" name="year" value={year} />
          <p className="muted">A snapshot freezes this packet so later edits don&rsquo;t change what you sent.</p>
          <button className="btn secondary" type="submit">Save snapshot</button>
        </form>
        {snaps.length > 0 && <ul className="plain">{snaps.map((s) => <li key={s.id}><a href={`/api/tax-packet?snapshot=${s.id}`}>Snapshot {s.id} (JSON)</a> saved {s.created_at}</li>)}</ul>}
      </div>
    </main>
  );
}
