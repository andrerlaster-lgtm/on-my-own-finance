import { parseCents } from "./money";
import { parseDate } from "./dates";
import { checkAdd, isLowStock, type Movement } from "./inventory";
import { checkLotConsistency, lotBalances, suggestAllocation, type LotUse } from "./lots";

/*
 * Appointment money and supplies (Phase 2). Pure rules; the database function does the saving, atomically.
 *
 * Cash basis, nothing new in the ledger:
 *  - A PRICE is expected revenue. It is not income and not a receivable while the appointment is open.
 *  - A PAYMENT is money actually received. Each non-Square payment creates exactly ONE income entry (the same table Income already uses), so income,
 *    the ledger and tax summaries count it once. Payments made before the appointment (advances) are income when received and are never repeated at completion.
 *  - A RECEIVABLE exists only for a COMPLETED appointment and is just price minus payments, calculated every time (never stored), so it cannot drift
 *    and it never touches income, the Profit & Loss or tax figures.
 *  - Square / Card payments never create income themselves: the Square import is the one source for card income (with its real fees). The payment is
 *    recorded as "awaiting Square" and linked to the imported entry by its exact Square payment ID (automatically) or by an explicit choice.
 *    Amount and date alone are never used to match.
 *  - SUPPLIES are ordinary inventory "use" movements (same table, same stock, valuation and cost rules, same lot logic), linked to the appointment.
 * No names, phone numbers, addresses or medical details exist anywhere here: methods, statuses and numbers only.
 */
export const PAYMENT_METHODS = [
  { id: "cash", label: "Cash" },
  { id: "check", label: "Check" },
  { id: "bank_transfer", label: "Bank transfer" },
  { id: "square", label: "Square / Card" },
  { id: "other", label: "Other" },
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["id"];
export const METHOD_LABELS: Record<string, string> = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.id, m.label]));
export const MAX_CENTS = 99_999_999_999;

export type ReconcileState = "none" | "awaiting_square" | "matched";
export const RECONCILE_LABELS: Record<ReconcileState, string> = { none: "", awaiting_square: "Awaiting Square import", matched: "Matched to Square import" };

export interface AppointmentPayment {
  id: number; appointment_id: number; amount_cents: number; method: PaymentMethod; paid_on: string;
  income_entry_id: number | null; reconcile_state: ReconcileState; square_payment_id: string | null;
}

/** "120", "120.50", "0" -> cents. Blank = no price recorded (null). A price of 0 is an explicit "no charge". "bad" = not a valid amount. */
export function parsePrice(raw: string | undefined): number | null | "bad" {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  const c = parseCents(s);
  return c === null || c > MAX_CENTS ? "bad" : c;
}

export type PayStatus = "paid" | "partial" | "unpaid" | "no_charge";
export const balanceOf = (price: number | null, paid: number): number => Math.max((price ?? 0) - paid, 0);

/** Payment status of a priced appointment. A $0 service is "no charge", never "unpaid". */
export function payStatus(price: number | null, paid: number): PayStatus {
  if (price === 0) return "no_charge";
  if (price !== null && paid >= price) return "paid";
  return paid > 0 ? "partial" : "unpaid";
}
export const PAY_LABELS: Record<PayStatus, string> = { paid: "Paid", partial: "Partially Paid", unpaid: "Unpaid", no_charge: "No charge" };

/** The one-line financial status shown next to an appointment. */
export function financeLabel(status: string, price: number | null, paid: number): string {
  if (status === "canceled") return "Canceled";
  if (status === "completed") return `Completed / ${PAY_LABELS[payStatus(price, paid)]}`;
  return price === null ? "No price set" : paid > 0 ? `Expected (advance paid)` : "Expected";
}

type Fin = { status: string; price_cents: number | null; paid_cents: number };
/** Expected revenue: what is still to be received on appointments that are scheduled or confirmed. Canceled and completed ones are not in it. */
export const expectedRevenue = (list: readonly Fin[]): number => list.filter((a) => a.status === "scheduled" || a.status === "confirmed").reduce((s, a) => s + balanceOf(a.price_cents, a.paid_cents), 0);
/** Accounts receivable: unpaid balances of COMPLETED appointments only. */
export const receivableTotal = (list: readonly Fin[]): number => list.filter((a) => a.status === "completed").reduce((s, a) => s + balanceOf(a.price_cents, a.paid_cents), 0);

/* ---------------- payment form ---------------- */
export interface PaymentInput { amount_cents: number; method: PaymentMethod; paid_on: string; square_payment_id: string | null; request_key: string }
export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export const REQUEST_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const SQUARE_ID = /^(t:)?[A-Za-z0-9_-]{1,64}$/;

/** `balance` = what can still be paid; `today` = the latest allowed payment date (Chicago). */
export function parsePaymentForm(f: Record<string, string | undefined>, balance: number, today: string): Parsed<PaymentInput> {
  const errors: string[] = [];
  const amount = parseCents(f.amount);
  if (amount === null || amount <= 0) errors.push("Amount received: dollars above zero, like 50 or 50.00.");
  else if (amount > balance) errors.push(`Amount received can't be more than the balance of $${(balance / 100).toFixed(2)}.`);
  const method = f.method as PaymentMethod;
  if (!PAYMENT_METHODS.some((m) => m.id === method)) errors.push("Payment method: choose one.");
  const paid_on = parseDate(f.paid_on);
  if (!paid_on) errors.push("Payment date: use the real date the money was received.");
  else if (paid_on > today) errors.push("Payment date can't be in the future.");
  const sq = (f.square_payment_id ?? "").trim();
  if (sq !== "" && method !== "square") errors.push("A Square payment ID only goes with the Square / Card method.");
  if (sq !== "" && !SQUARE_ID.test(sq)) errors.push("Square payment ID: letters, numbers, dashes and underscores only (copy it from Square).");
  const key = (f.request_key ?? "").trim();
  if (!REQUEST_KEY.test(key)) errors.push("This form expired. Reload the page and try again.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { amount_cents: amount as number, method, paid_on: paid_on as string, square_payment_id: sq === "" ? null : sq, request_key: key } };
}

/* ---------------- completion form ---------------- */
export interface SupplyRequest { item_id: number; quantity: number }
export interface CompletionInput { price_cents: number; payment: PaymentInput | null; supplies: SupplyRequest[] }

/**
 * One form for the whole completion. `currentPrice` is the price already recorded (null if none); `paid` what has already been received (advances);
 * `today` the latest allowed payment date. A blank or zero amount means "nothing received": the balance becomes a receivable.
 */
export function parseCompletionForm(f: Record<string, string | undefined>, currentPrice: number | null, paid: number, today: string): Parsed<CompletionInput> {
  const errors: string[] = [];
  const priceRaw = parsePrice(f.price);
  if (priceRaw === "bad") errors.push("Service price: dollars like 120 or 120.00 (0 if there is no charge).");
  const price = priceRaw === "bad" ? null : priceRaw ?? currentPrice;
  if (priceRaw !== "bad" && price === null) errors.push("Service price: enter the price (0 if there is no charge).");
  if (price !== null && price < paid) errors.push(`The price can't be lower than the $${(paid / 100).toFixed(2)} already received.`);

  let payment: PaymentInput | null = null;
  const amt = (f.amount ?? "").trim();
  const wants = amt !== "" && parseCents(amt) !== 0;
  if (wants) {
    const p = parsePaymentForm(f, price === null ? 0 : Math.max(price - paid, 0), today);
    if (!p.ok) errors.push(...p.errors); else payment = p.value;
  }
  const supplies: SupplyRequest[] = [];
  for (const [k, v] of Object.entries(f)) {
    const m = /^qty_(\d{1,12})$/.exec(k);
    if (!m || (v ?? "").trim() === "" || v?.trim() === "0") continue;
    if (!/^\d{1,7}$/.test((v ?? "").trim()) || Number(v) < 1 || Number(v) > 1_000_000) { errors.push("Supplies used: whole numbers from 1 up, or leave empty."); break; }
    supplies.push({ item_id: Number(m[1]), quantity: Number(v) });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { price_cents: price as number, payment, supplies: supplies.sort((a, b) => a.item_id - b.item_id) } };
}

/* ---------------- supplies ---------------- */
export interface PlannedUse { item_id: number; quantity: number; moved_on: string; allocations: { lot_number: string; quantity: number }[]; expect: { movements: number; max_id: number; lot_uses: number } }
export interface ItemHistory { id: number; label: string; movements: readonly Movement[]; lotUses: readonly LotUse[] }

/** What the database must still see when it saves: if any of this changed meanwhile, nothing is saved and the screen is rebuilt. */
export const stockToken = (movements: readonly Movement[], lotUses: readonly LotUse[]) => ({ movements: movements.length, max_id: movements.reduce((m, x) => Math.max(m, x.id), 0), lot_uses: lotUses.length });

/**
 * Checks every requested supply with the SAME rules the Inventory page uses (the whole history replayed with the use included, so stock can never go
 * negative; lots taken earliest-expiring first) and returns the movements to save. Nothing is saved here.
 */
export function planSupplies(requests: readonly SupplyRequest[], items: readonly ItemHistory[], movedOn: string): { ok: true; uses: PlannedUse[] } | { ok: false; error: string } {
  const uses: PlannedUse[] = [];
  for (const r of requests) {
    const it = items.find((x) => x.id === r.item_id);
    if (!it) return { ok: false, error: "A supply you chose no longer exists." };
    const err = checkAdd(it.movements, { item_id: it.id, moved_on: movedOn, kind: "use", quantity: r.quantity, unit_cost_cents: null, reason: null, lot_number: null, expires_on: null })
      ?? checkLotConsistency(it.movements, { kind: "use", lot_number: null, expires_on: null });
    if (err) return { ok: false, error: `${it.label}: ${err}` };
    const lots = lotBalances(it.movements, it.lotUses);
    const allocations = lots.length ? suggestAllocation(lots, r.quantity).allocations : [];
    uses.push({ item_id: it.id, quantity: r.quantity, moved_on: movedOn, allocations, expect: stockToken(it.movements, it.lotUses) });
  }
  return { ok: true, uses };
}

/** Items that are at or below their reorder level after the use (the existing reorder rule, unchanged). */
export const reorderNeeded = <T extends { onHand: number; reorder_level: number | null }>(items: readonly T[]): T[] => items.filter((i) => isLowStock(i.onHand, i.reorder_level));

/** Friendly text for the codes the database function raises (OMOF:CODE). */
const DB_ERRORS: Record<string, string> = {
  NOT_FOUND: "That appointment no longer exists.",
  NOT_OPEN: "This appointment can't be completed (it is canceled).",
  ALREADY_COMPLETED: "This appointment was already completed. Nothing was recorded twice.",
  NOT_STARTED: "An appointment can be completed only after it has started.",
  NO_PRICE: "Enter the service price first (0 if there is no charge).",
  PRICE_BELOW_PAID: "The price can't be lower than what has already been received.",
  CANCELED: "Payments can't be added to a canceled appointment.",
  BAD_AMOUNT: "The amount must be above zero.",
  OVERPAYMENT: "That is more than the remaining balance.",
  SQUARE_LINKED: "That Square payment is already linked to another appointment payment.",
  SQUARE_MISMATCH: "That Square payment was already imported with a different amount, so it was not linked. Check the payment ID and amount.",
  SQUARE_ID_USED: "That Square payment ID is already recorded on another payment.",
  KEY_REUSED: "This form was already used for a different appointment. Reload the page.",
  STALE_INVENTORY: "Inventory changed while you were working. Review the supplies and try again.",
  NEGATIVE_STOCK: "There is not enough stock for one of the supplies. Nothing was saved.",
};
export function dbErrorText(message: string): string | null {
  const m = /OMOF:([A-Z_]+)/.exec(message);
  return m ? DB_ERRORS[m[1]] ?? "Something did not add up, so nothing was saved." : null;
}
export const dbErrorCode = (message: string): string | null => /OMOF:([A-Z_]+)/.exec(message)?.[1] ?? null;
