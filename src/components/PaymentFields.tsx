import { PAYMENT_METHODS } from "@/lib/finance";

/**
 * The payment fields used on the completion screen, the appointment page and Accounts Receivable. Amount, method and date are fixed-shape inputs; the only typed text is an
 * optional Square payment ID (a machine reference copied from Square, never a name). `requestKey` is unique to this rendering of the form: submitting the same form twice
 * can only ever record one payment.
 */
export function PaymentFields({ idPrefix, defaultAmount, today, requestKey, amountOptional = false }: { idPrefix: string; defaultAmount: string; today: string; requestKey: string; amountOptional?: boolean }) {
  return (
    <>
      <input type="hidden" name="request_key" value={requestKey} />
      <label htmlFor={`${idPrefix}a`}>Amount received ($){amountOptional ? " (leave empty or 0 if nothing was paid)" : ""}</label>
      <input id={`${idPrefix}a`} name="amount" type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" defaultValue={defaultAmount} required={!amountOptional} />
      <label htmlFor={`${idPrefix}m`}>Payment method</label>
      <select id={`${idPrefix}m`} name="method" defaultValue="cash">{PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
      <label htmlFor={`${idPrefix}d`}>Date received</label>
      <input id={`${idPrefix}d`} name="paid_on" type="date" defaultValue={today} max={today} required />
      <label htmlFor={`${idPrefix}s`}>Square payment ID (only for Square / Card, optional)</label>
      <input id={`${idPrefix}s`} name="square_payment_id" type="text" maxLength={70} autoComplete="off" placeholder="copy from Square" />
      <p className="muted">Cash, check, bank transfer and other payments go into Income right away. A Square / Card payment waits for your Square import and is matched by its payment ID, so it is never counted twice.</p>
    </>
  );
}
