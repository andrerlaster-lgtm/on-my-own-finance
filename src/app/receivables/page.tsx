import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, schemaVersion, listReceivables, recordAppointmentPayment, listAwaitingSquare, squareCandidates, linkSquarePayment } from "@/lib/db";
import { PAY_LABELS, METHOD_LABELS, balanceOf, parsePaymentForm, payStatus } from "@/lib/finance";
import { formatCents, centsToInput } from "@/lib/money";
import { todayInChicago } from "@/lib/dates";
import { PaymentFields } from "@/components/PaymentFields";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";
const back = (q: string): never => redirect(`/receivables${q}`);
const num = (fd: FormData, k: string) => (/^\d{1,12}$/.test(String(fd.get(k) ?? "")) ? Number(fd.get(k)) : 0);

async function pay(fd: FormData) {
  "use server";
  await requireOwner();
  const id = num(fd, "id"), raw: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") raw[k] = v;
  const row = (await listReceivables(true)).find((r) => r.id === id);
  if (!row) return back(`?error=${encodeURIComponent("That receivable was not found.")}`);
  const parsed = parsePaymentForm(raw, balanceOf(row.price_cents, row.paid_cents), todayInChicago());
  if (!parsed.ok) return back(`?error=${encodeURIComponent(parsed.errors.join(" | "))}`);
  const r = await recordAppointmentPayment(id, parsed.value);
  if (!r.ok) return back(`?error=${encodeURIComponent(r.error)}`);
  back("?saved=1");
}

async function link(fd: FormData) {
  "use server";
  await requireOwner();
  const ok = await linkSquarePayment(num(fd, "payment_id"), num(fd, "income_id"));
  back(ok ? "?saved=1" : `?error=${encodeURIComponent("That Square entry could not be linked (it may already be linked, or the amounts differ).")}`);
}

export default async function Receivables({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; paid?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  if (((await schemaVersion()) ?? 0) < 11) return <main><h1>Accounts Receivable</h1><div className="note">The database needs a one-time update first. Press <b>Update</b> on the Overview page, then come back.</div><p><Link href="/">← Overview</Link></p></main>;
  const sp = await searchParams, today = todayInChicago(), showPaid = sp.paid === "1";
  const [rows, awaiting] = await Promise.all([listReceivables(showPaid), listAwaitingSquare()]);
  const candidates = new Map(await Promise.all(awaiting.map(async (w) => [w.payment.id, await squareCandidates(w.payment.id)] as const)));
  const open = rows.filter((r) => r.price_cents > r.paid_cents), total = open.reduce((s, r) => s + r.price_cents - r.paid_cents, 0);
  return (
    <main>
      <h1>Accounts Receivable</h1>
      <div className="note">Money owed for completed appointments. A balance is <b>not income</b> until you receive it: income, the Profit &amp; Loss and tax figures count only payments received. Each payment you record here goes into Income once.</div>
      {sp.saved && <div className="note">Saved.</div>}
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      <div className="card grid2">
        <div className="stat">Outstanding<b>{formatCents(total)}</b></div>
        <div className="stat">Appointments with a balance<b>{open.length}</b></div>
      </div>
      <div className="card">
        <h2>Outstanding balances <span className="muted">{showPaid ? "including paid" : ""}</span></h2>
        {rows.length === 0 ? <p className="muted">Nothing outstanding.</p> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Appt</th><th>Service</th><th>Service date</th><th>Price</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/secretary/${r.id}`}>#{r.id}</Link></td><td>{r.service}</td><td>{r.service_date}</td><td>{formatCents(r.price_cents)}</td><td>{formatCents(r.paid_cents)}</td>
                <td><b>{formatCents(balanceOf(r.price_cents, r.paid_cents))}</b></td><td>{PAY_LABELS[payStatus(r.price_cents, r.paid_cents)]}</td>
              </tr>))}</tbody>
          </table></div>
        )}
        <p className="muted">{showPaid ? <Link href="/receivables">Hide fully paid</Link> : <Link href="/receivables?paid=1">Show fully paid too</Link>}</p>
      </div>
      {open.map((r) => (
        <details className="card" key={r.id}>
          <summary><b>Record a payment: appointment #{r.id}</b> ({r.service}, balance {formatCents(r.price_cents - r.paid_cents)})</summary>
          <form action={pay}>
            <input type="hidden" name="id" value={r.id} />
            <PaymentFields idPrefix={`r${r.id}`} defaultAmount={centsToInput(r.price_cents - r.paid_cents)} today={today} requestKey={crypto.randomUUID()} />
            <SubmitButton className="btn">Record payment</SubmitButton>
          </form>
        </details>
      ))}
      <div className="card">
        <h2>Square payments to reconcile <span className="muted">{awaiting.length}</span></h2>
        {awaiting.length === 0 ? <p className="muted">None. Every Square / Card payment is linked to an imported Square entry.</p> : (
          <>
            <p className="muted">These were taken by card but are not income yet: the Square import is the only record of card income (with its fees), so nothing is counted twice. When you import your Square export, a payment with a Square payment ID is linked automatically if the ID matches exactly. Otherwise choose the matching imported entry yourself below. Amount and date alone are never matched for you.</p>
            <ul className="entries">{awaiting.map((w) => (
              <li className="entry" key={w.payment.id}>
                <span className="what"><Link href={`/secretary/${w.payment.appointment_id}`}>Appointment #{w.payment.appointment_id}</Link> · {METHOD_LABELS[w.payment.method]}</span>
                <span className="amt">{formatCents(w.payment.amount_cents)}</span>
                <span className="meta">received {w.payment.paid_on}{w.payment.square_payment_id ? " · Square ID entered, waiting for the import" : " · no Square ID entered"}</span>
                <div className="acts">
                  {(candidates.get(w.payment.id) ?? []).length === 0 ? <span className="muted">No unlinked imported Square entry with exactly {formatCents(w.payment.amount_cents)} yet. <Link href="/income/import">Import Square</Link></span> : (
                    <form action={link}>
                      <input type="hidden" name="payment_id" value={w.payment.id} />
                      <label htmlFor={`c${w.payment.id}`}>This payment is the Square entry:</label>
                      <select id={`c${w.payment.id}`} name="income_id" defaultValue="">{[<option key="none" value="" disabled>Choose one…</option>, ...(candidates.get(w.payment.id) ?? []).map((c) => <option key={c.id} value={c.id}>{c.occurred_on} · {formatCents(c.gross_cents)} · ID …{c.tail}</option>)]}</select>
                      <SubmitButton className="btn secondary">Link</SubmitButton>
                    </form>
                  )}
                </div>
              </li>))}</ul>
          </>
        )}
      </div>
    </main>
  );
}
