import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, schemaVersion, listServices, getAppointment, updateAppointment, setAppointmentStatus, listAppointmentPayments, listSupplyUses, recordAppointmentPayment, listItems } from "@/lib/db";
import { PAY_LABELS, RECONCILE_LABELS, METHOD_LABELS, balanceOf, financeLabel, parsePaymentForm, payStatus, reorderNeeded } from "@/lib/finance";
import { formatCents, centsToInput } from "@/lib/money";
import { todayInChicago } from "@/lib/dates";
import { PaymentFields } from "@/components/PaymentFields";
import { CANCEL_REASONS, CANCEL_REASON_LABELS, STATUS_LABELS, TYPE_LABELS, allowedNext, checkTransition, dayLabel, isEditable, isStatus, minutesOf, parseAppointmentForm, parseCancelReason, startLabel, toLocal } from "@/lib/schedule";
import { AppointmentForm } from "@/components/AppointmentForm";
import { SecretaryNav } from "@/components/SecretaryNav";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";
const idOf = (fd: FormData) => (/^\d{1,12}$/.test(String(fd.get("id") ?? "")) ? Number(fd.get("id")) : 0);
const back = (id: number, q: string): never => redirect(`/secretary/${id}?${q}`);

async function save(fd: FormData) {
  "use server";
  await requireOwner();
  const id = idOf(fd);
  const raw: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") raw[k] = v;
  const current = id ? await getAppointment(id) : null;
  if (!current) return back(id, `error=${encodeURIComponent("Appointment not found.")}`);
  // An appointment may keep a service that has since been retired (and its existing length); only NEW choices are limited to the current four.
  const services = (await listServices()).map((s) => (s.code === current.service_code ? { ...s, active: true } : s));
  const parsed = parseAppointmentForm(raw, services, minutesOf(current), current.price_cents);
  if (!parsed.ok) return back(id, `error=${encodeURIComponent(parsed.errors.join(" | "))}`);
  const r = await updateAppointment(id, parsed.value);
  if (!r.ok) return back(id, `error=${encodeURIComponent(r.error)}`);
  back(id, "saved=1");
}

async function changeStatus(fd: FormData) {
  "use server";
  await requireOwner();
  const id = idOf(fd), to = String(fd.get("to") ?? "");
  const current = id ? await getAppointment(id) : null;
  if (!current || !isStatus(to)) return back(id, `error=${encodeURIComponent("Appointment not found.")}`);
  if (to === "completed") redirect(`/secretary/${id}/complete`); // completing always goes through the one workflow (payment and supplies)
  const problem = checkTransition(current.status, to, current.starts_at, Date.now());
  if (problem) return back(id, `error=${encodeURIComponent(problem)}`);
  const reason = to === "canceled" ? parseCancelReason(String(fd.get("reason") ?? "")) : null;
  if (to === "canceled" && !reason) return back(id, `error=${encodeURIComponent("Choose a reason for canceling.")}`);
  const r = await setAppointmentStatus(id, current.status, to, reason);
  if (!r.ok) return back(id, `error=${encodeURIComponent(r.error)}`);
  back(id, "saved=1");
}

async function addPayment(fd: FormData) {
  "use server";
  await requireOwner();
  const id = idOf(fd), raw: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") raw[k] = v;
  const current = id ? await getAppointment(id) : null;
  if (!current) return back(id, `error=${encodeURIComponent("Appointment not found.")}`);
  if (current.status === "canceled") return back(id, `error=${encodeURIComponent("Payments can't be added to a canceled appointment.")}`);
  if (current.price_cents === null) return back(id, `error=${encodeURIComponent("Enter the service price first (0 if there is no charge).")}`);
  const parsed = parsePaymentForm(raw, balanceOf(current.price_cents, current.paid_cents), todayInChicago());
  if (!parsed.ok) return back(id, `error=${encodeURIComponent(parsed.errors.join(" | "))}`);
  const r = await recordAppointmentPayment(id, parsed.value);
  if (!r.ok) return back(id, `error=${encodeURIComponent(r.error)}`);
  back(id, "saved=1");
}

export default async function AppointmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string; completed?: string; low?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  if (((await schemaVersion()) ?? 0) < 11) redirect("/secretary");
  const { id: rawId } = await params;
  if (!/^\d{1,12}$/.test(rawId)) notFound();
  const [a, services, sp] = await Promise.all([getAppointment(Number(rawId)), listServices(), searchParams]);
  if (!a) notFound();
  const s = toLocal(a.starts_at);
  const label = services.find((x) => x.code === a.service_code)?.label ?? a.service_code;
  const moves = allowedNext(a.status);
  const [payments, supplies, allItems] = await Promise.all([listAppointmentPayments(a.id), listSupplyUses(a.id), listItems()]);
  const balance = balanceOf(a.price_cents, a.paid_cents), today = todayInChicago();
  const lowIds = new Set((sp.low ?? "").split(",").filter((x) => /^\d{1,12}$/.test(x)).map(Number));
  const reorder = reorderNeeded(allItems.map((i) => ({ ...i, onHand: i.stock.onHand }))).filter((i) => lowIds.has(i.id));
  const canPay = a.status !== "canceled" && a.price_cents !== null && balance > 0;
  return (
    <main>
      <h1>Appointment #{a.id}</h1>
      <SecretaryNav date={s.date} active="day" />
      {sp.saved && <div className="note">Saved.</div>}
      {sp.completed && <div className="note">Appointment completed: {financeLabel(a.status, a.price_cents, a.paid_cents)}. Payment, balance and supplies are recorded below.</div>}
      {reorder.length > 0 && <div className="card err"><b>Reorder needed</b><ul className="plain">{reorder.map((i) => <li key={i.id}><Link href={`/inventory/${i.id}`}>{i.label}</Link>: {i.onHand} {i.unit} left (reorder level {i.reorder_level})</li>)}</ul></div>}
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      <div className="card">
        <h2>{label} <span className="muted">{STATUS_LABELS[a.status]}</span></h2>
        <p>{dayLabel(s.date)} at {startLabel(a)}<br /><span className="muted">{TYPE_LABELS[a.type]}{a.cancel_reason ? ` · canceled: ${CANCEL_REASON_LABELS[a.cancel_reason]}` : ""}{a.source !== "internal" ? ` · from the ${a.source}` : ""}</span></p>
        {moves.length > 0 && (
          <div className="row">
            {moves.filter((m) => m !== "canceled").map((m) => (
              <form key={m} action={changeStatus} className="inline"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="to" value={m} /><SubmitButton className="btn secondary">{a.status === "canceled" ? "Reinstate as scheduled" : m === "completed" ? "Mark completed" : `Mark ${STATUS_LABELS[m].toLowerCase()}`}</SubmitButton></form>
            ))}
          </div>
        )}
        {moves.includes("canceled") && (
          <form action={changeStatus}>
            <input type="hidden" name="id" value={a.id} /><input type="hidden" name="to" value="canceled" />
            <label htmlFor="cr">Cancel this appointment. Reason:</label>
            <select id="cr" name="reason" defaultValue="requested">{CANCEL_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
            <p><SubmitButton className="btn secondary">Cancel appointment</SubmitButton></p>
          </form>
        )}
        {a.status === "completed" && <p className="muted">Completed appointments are final. Corrections to supplies are made with an inventory adjustment on the Inventory page; income corrections are made explicitly, never automatically.</p>}
        {a.status === "canceled" && payments.length > 0 && <p className="muted">Payments already received stay recorded: canceling never reverses money or supplies. A refund or correction must be entered deliberately.</p>}
      </div>
      <div className="card">
        <h2>Money <span className="muted">{financeLabel(a.status, a.price_cents, a.paid_cents)}</span></h2>
        <div className="grid2">
          <div className="stat">Service price<b>{a.price_cents === null ? "not set" : formatCents(a.price_cents)}</b></div>
          <div className="stat">{a.status === "completed" || a.status === "canceled" ? "Received" : "Received so far"}<b>{formatCents(a.paid_cents)}</b></div>
          {a.status === "completed" && <div className="stat">Outstanding (receivable)<b>{formatCents(balance)}</b></div>}
          {(a.status === "scheduled" || a.status === "confirmed") && a.price_cents !== null && <div className="stat">Expected revenue (not yet received)<b>{formatCents(balance)}</b></div>}
          {a.status === "completed" && a.price_cents !== null && <div className="stat">Payment status<b>{PAY_LABELS[payStatus(a.price_cents, a.paid_cents)]}</b></div>}
        </div>
        {a.status === "completed" && balance > 0 && <p className="muted">This balance is on <Link href="/receivables">Accounts Receivable</Link>. It is not income until it is received.</p>}
        {payments.length > 0 && (
          <>
            <h2 style={{ marginTop: 14 }}>Payment history</h2>
            <ul className="entries">{payments.map((p) => (
              <li className="entry" key={p.id}>
                <span className="what">{formatCents(p.amount_cents)} · {METHOD_LABELS[p.method]}</span>
                <span className="meta">{p.paid_on}{p.reconcile_state !== "none" ? ` · ${RECONCILE_LABELS[p.reconcile_state]}` : ""}{p.reconcile_state === "awaiting_square" ? " (see Accounts Receivable to reconcile)" : ""}</span>
              </li>))}</ul>
          </>
        )}
        {canPay && (
          <details className="mini" style={{ marginTop: 10 }}>
            <summary>{a.status === "completed" ? "Record a payment on this balance" : "Record an advance payment"}</summary>
            <form action={addPayment}>
              <input type="hidden" name="id" value={a.id} />
              <PaymentFields idPrefix="pp" defaultAmount={centsToInput(balance)} today={today} requestKey={crypto.randomUUID()} />
              <SubmitButton className="btn secondary">Record payment</SubmitButton>
            </form>
          </details>
        )}
      </div>
      {(a.status === "completed" || supplies.length > 0) && (
        <div className="card">
          <h2>Supplies used <span className="muted">{supplies.length}</span></h2>
          {supplies.length === 0 ? <p className="muted">No tracked supplies were recorded for this appointment.</p> : <ul className="entries">{supplies.map((u) => <li className="entry" key={u.movement_id}><span className="what"><Link href={`/inventory/${u.item_id}`}>{u.label}</Link></span><span className="amt">{u.quantity} {u.unit}</span><span className="meta">taken from stock on {u.moved_on}</span></li>)}</ul>}
          <p className="muted">To correct a quantity, make an adjustment on the item&rsquo;s Inventory page (it is kept in the audit trail).</p>
        </div>
      )}
      {isEditable(a.status) && <>
        <h2>Change the time or details</h2>
        <AppointmentForm action={save} services={services} submitLabel="Save changes" hidden={{ id: a.id }} values={{ date: s.date, time: s.time, type: a.type, service_code: a.service_code, price: a.price_cents === null ? "" : centsToInput(a.price_cents) }} />
      </>}
      <p><Link href={`/secretary?date=${s.date}`}>← Back to the calendar</Link></p>
    </main>
  );
}
