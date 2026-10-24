import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, listPayments, addPayment, deletePayment } from "@/lib/db";
import { PAYMENT_KINDS, parsePaymentForm } from "@/lib/taxforms";
import { formatCents } from "@/lib/money";
import { todayInChicago } from "@/lib/dates";
import { parseYear } from "@/lib/taxRules";
import { Nav } from "@/components/Nav";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";
const to = (year: number | string, q: string) => redirect(`/taxes/payments?year=${year}&${q}`);

async function add(fd: FormData) {
  "use server";
  await requireOwner();
  const raw: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") raw[k] = v;
  const year = parseYear(raw.tax_year) ?? todayInChicago().slice(0, 4);
  const p = parsePaymentForm(raw);
  if (!p.ok) return to(year, `error=${encodeURIComponent(p.errors.join(" | "))}`);
  await addPayment(p.value);
  return to(p.value.tax_year, "saved=1");
}

async function remove(fd: FormData) {
  "use server";
  await requireOwner();
  const id = Number(fd.get("id")), year = parseYear(String(fd.get("year") ?? "")) ?? todayInChicago().slice(0, 4);
  if (Number.isInteger(id) && id > 0) await deletePayment(id);
  return to(year, "saved=1");
}

export default async function Payments({ searchParams }: { searchParams: Promise<{ year?: string; error?: string; saved?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const sp = await searchParams;
  const today = todayInChicago();
  const year = parseYear(sp.year) ?? Number(today.slice(0, 4));
  const list = await listPayments(year);
  return (
    <main>
      <Nav />
      <p><Link href={`/taxes?year=${year}`}>← Taxes {year}</Link></p>
      <h1>Tax payments for {year}</h1>
      <div className="note">Record payments you actually made (for example an estimated payment). Due dates and amounts come from your tax preparer; this app does not remind or calculate them.</div>
      {sp.saved && <div className="note">Saved.</div>}
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      <form action={add} className="card">
        <h2>Add a payment</h2>
        <label htmlFor="ty">For tax year</label><input id="ty" name="tax_year" type="number" min={2000} max={2100} defaultValue={year} />
        <label htmlFor="po">Date paid</label><input id="po" name="paid_on" type="date" defaultValue={today} required />
        <label htmlFor="am">Amount ($)</label><input id="am" name="amount" type="text" inputMode="decimal" placeholder="0.00" required />
        <label htmlFor="kd">Type</label><select id="kd" name="kind">{PAYMENT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
        <p><SubmitButton className="btn">Add payment</SubmitButton></p>
      </form>
      <div className="card tablewrap">
        <h2>Recorded</h2>
        {list.length === 0 ? <p className="muted">None yet.</p> : (
          <table><thead><tr><th>Paid</th><th>Type</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>{list.map((x) => (
              <tr key={x.id}><td>{x.paid_on}</td><td>{PAYMENT_KINDS.find((k) => k.id === x.kind)?.label}</td><td className="num">{formatCents(x.amount_cents)}</td>
                <td><form action={remove} className="inline"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="year" value={year} /><SubmitButton className="linkbtn">Delete</SubmitButton></form></td></tr>
            ))}</tbody>
            <tfoot><tr><th colSpan={2}>Total</th><th className="num">{formatCents(list.reduce((s, x) => s + x.amount_cents, 0))}</th><th /></tr></tfoot></table>
        )}
      </div>
    </main>
  );
}
