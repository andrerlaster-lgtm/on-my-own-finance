import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, schemaVersion, getAppointment, listServices, listAppointmentPayments, listItems, completeAppointment } from "@/lib/db";
import { TYPE_LABELS, canComplete, dayLabel, startLabel, toLocal } from "@/lib/schedule";
import { balanceOf, parseCompletionForm, reorderNeeded } from "@/lib/finance";
import { formatCents, centsToInput } from "@/lib/money";
import { todayInChicago } from "@/lib/dates";
import { PaymentFields } from "@/components/PaymentFields";
import { SecretaryNav } from "@/components/SecretaryNav";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";
const idOf = (fd: FormData) => (/^\d{1,12}$/.test(String(fd.get("id") ?? "")) ? Number(fd.get("id")) : 0);
const fail = (id: number, msg: string): never => redirect(`/secretary/${id}/complete?error=${encodeURIComponent(msg)}`);

/** The whole completion: price, payment and supplies are checked here and saved together by one database call, or not at all. */
async function complete(fd: FormData) {
  "use server";
  await requireOwner();
  const id = idOf(fd), raw: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") raw[k] = v;
  const a = id ? await getAppointment(id) : null;
  if (!a) return fail(id, "Appointment not found.");
  if (a.status === "completed") redirect(`/secretary/${id}?saved=1`); // a second tap or a second tab: already done, nothing is repeated
  if (a.status !== "scheduled" && a.status !== "confirmed") return fail(id, "Only a scheduled or confirmed appointment can be completed.");
  if (!canComplete(a.starts_at, Date.now())) return fail(id, "An appointment can be marked completed only after it has started.");
  const parsed = parseCompletionForm(raw, a.price_cents, a.paid_cents, todayInChicago());
  if (!parsed.ok) return fail(id, parsed.errors.join(" | "));
  const r = await completeAppointment(id, parsed.value, toLocal(a.starts_at).date);
  if (!r.ok) return fail(id, r.error);
  const low = reorderNeeded((await listItems()).map((i) => ({ ...i, onHand: i.stock.onHand }))).filter((i) => r.items.some((u) => u.item_id === i.id)).map((i) => i.id);
  redirect(`/secretary/${id}?completed=1${low.length ? `&low=${low.join(",")}` : ""}`);
}

export default async function CompleteAppointment({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  if (((await schemaVersion()) ?? 0) < 11) redirect("/secretary");
  const { id: rawId } = await params;
  if (!/^\d{1,12}$/.test(rawId)) notFound();
  const [a, services, sp] = await Promise.all([getAppointment(Number(rawId)), listServices(), searchParams]);
  if (!a) notFound();
  if (a.status !== "scheduled" && a.status !== "confirmed") redirect(`/secretary/${a.id}`);
  const [payments, items] = await Promise.all([listAppointmentPayments(a.id), listItems()]);
  const s = toLocal(a.starts_at), today = todayInChicago();
  const label = services.find((x) => x.code === a.service_code)?.label ?? a.service_code;
  const balance = balanceOf(a.price_cents, a.paid_cents);
  return (
    <main>
      <p><Link href={`/secretary/${a.id}`}>← Appointment #{a.id}</Link></p>
      <h1>Complete appointment #{a.id}</h1>
      <SecretaryNav date={s.date} active="day" />
      <div className="note">Everything for this visit is saved together: if any part cannot be saved (for example not enough stock), nothing is saved and the appointment stays open. Do not put patient information anywhere on this screen.</div>
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      {!canComplete(a.starts_at, Date.now()) && <div className="card err">This appointment has not started yet, so it cannot be completed.</div>}
      <form action={complete}>
        <input type="hidden" name="id" value={a.id} />
        <div className="card">
          <h2>Service</h2>
          <p><b>{label}</b> · {TYPE_LABELS[a.type]}<br /><span className="muted">{dayLabel(s.date)} at {startLabel(a)}</span></p>
          <label htmlFor="cp">Service price ($)</label>
          <input id="cp" name="price" type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" defaultValue={a.price_cents === null ? "" : centsToInput(a.price_cents)} required />
          <p className="muted">Enter 0 if there is no charge. {a.paid_cents > 0 ? `Already received before today: ${formatCents(a.paid_cents)} (not recorded again).` : ""}</p>
          {payments.length > 0 && <ul className="plain">{payments.map((p) => <li key={p.id}>{p.paid_on}: {formatCents(p.amount_cents)} already recorded</li>)}</ul>}
        </div>
        <div className="card">
          <h2>Payment</h2>
          <p className="muted">Enter what you received now. Leave the amount empty or 0 if the customer has not paid: the balance goes on Accounts Receivable and is not counted as income. Part of the price is fine too; the rest becomes a receivable.</p>
          <PaymentFields idPrefix="cm" defaultAmount={a.price_cents === null ? "" : centsToInput(balance)} today={today} requestKey={crypto.randomUUID()} amountOptional />
        </div>
        <div className="card">
          <h2>Supplies used <span className="muted">optional</span></h2>
          {items.length === 0 ? <p className="muted">No inventory items yet. <Link href="/inventory">Add supplies</Link> to track them.</p> : (
            <>
              <p className="muted">Enter only what you actually used. Quantities come out of stock when you complete the appointment (earliest-expiring lot first). Leave everything empty if no tracked supplies were used.</p>
              <div className="tablewrap"><table>
                <thead><tr><th>Supply</th><th>On hand</th><th>Quantity used</th></tr></thead>
                <tbody>{items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.label}{reorderNeeded([{ onHand: i.stock.onHand, reorder_level: i.reorder_level }]).length ? <span className="badge"> reorder needed</span> : null}</td>
                    <td>{i.stock.onHand} {i.unit}</td>
                    <td><input name={`qty_${i.id}`} type="number" inputMode="numeric" min="0" step="1" placeholder="0" aria-label={`Quantity of ${i.label} used`} style={{ maxWidth: 110 }} /></td>
                  </tr>))}</tbody>
              </table></div>
            </>
          )}
        </div>
        <p><SubmitButton className="btn">Complete appointment</SubmitButton></p>
      </form>
    </main>
  );
}
