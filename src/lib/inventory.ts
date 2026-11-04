import { parseCents } from "./money";
import { parseDate } from "./dates";

/*
 * Inventory is its own ledger. It never creates an expense and never counts a visit: buying stock is not an expense yet
 * (expenses come in a later phase) and using stock is not a patient visit.
 *
 * Quantity on hand is calculated from the movements, never typed in. Whole units only; keep one unit per item (box, pack, each).
 * Cost uses the weighted average, tracked as a running total value in whole cents so nothing drifts:
 *   purchase/opening:  on hand += q,  value += q x unit cost
 *   use/adjust down:   value removed = value x q / on hand (all remaining value when the last unit goes)
 *   adjust up:         added at the current average cost (zero if nothing was on hand)
 *   average cost = value / on hand,   inventory value = the running total
 * Movements are replayed in date order (then entry order); a movement that would make stock go negative at any point is refused.
 * Lot numbers and expiry dates are recorded on purchases and opening stock only; per-lot stock tracking comes later.
 */
export const KINDS = [
  { id: "opening", label: "Opening stock (with cost)" },
  { id: "purchase", label: "Purchased / added (with cost)" },
  { id: "use", label: "Used / removed" },
  { id: "adjust_up", label: "Adjustment: add (count correction)" },
  { id: "adjust_down", label: "Adjustment: remove (count correction)" },
] as const;
export type Kind = (typeof KINDS)[number]["id"];
export const KIND_LABELS: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.id, k.label]));

export const REASONS = [
  { id: "count_correction", label: "Count correction" },
  { id: "expired", label: "Expired" },
  { id: "damaged", label: "Damaged" },
  { id: "lost", label: "Lost" },
  { id: "other", label: "Other" },
] as const;
export type Reason = (typeof REASONS)[number]["id"];
export const REASON_LABELS: Record<string, string> = Object.fromEntries(REASONS.map((r) => [r.id, r.label]));

export interface Movement {
  id: number; item_id: number; moved_on: string; kind: Kind; quantity: number;
  unit_cost_cents: number | null; reason: Reason | null; lot_number: string | null; expires_on: string | null;
}
export interface Stock { onHand: number; valueCents: number; avgCostCents: number }
export type Replay = ({ ok: true } & Stock) | { ok: false; error: string };

const byOrder = (a: Movement, b: Movement) => (a.moved_on < b.moved_on ? -1 : a.moved_on > b.moved_on ? 1 : a.id - b.id);

export interface Step { m: Movement; onHand: number; valueCents: number; valueDelta: number }
export type StepsResult = { ok: true; steps: Step[] } | { ok: false; error: string };

/** The full replay, one step per movement (stock and value after it, and how much value it added or removed). */
export function replaySteps(movements: readonly Movement[]): StepsResult {
  let onHand = 0, value = 0;
  const steps: Step[] = [];
  for (const m of [...movements].sort(byOrder)) {
    const q = m.quantity, before = value;
    if (m.kind === "opening" || m.kind === "purchase") {
      onHand += q; value += q * (m.unit_cost_cents ?? 0);
    } else if (m.kind === "adjust_up") {
      value += onHand > 0 ? Math.round((value * q) / onHand) : 0; onHand += q;
    } else {
      if (q > onHand) return { ok: false, error: `Not enough on hand on ${m.moved_on}: only ${onHand} (tried to take ${q}).` };
      value -= q === onHand ? value : Math.round((value * q) / onHand); onHand -= q;
    }
    steps.push({ m, onHand, valueCents: value, valueDelta: value - before });
  }
  return { ok: true, steps };
}

export function replay(movements: readonly Movement[]): Replay {
  const r = replaySteps(movements);
  if (!r.ok) return r;
  const last = r.steps[r.steps.length - 1];
  const onHand = last?.onHand ?? 0, value = last?.valueCents ?? 0;
  return { ok: true, onHand, valueCents: value, avgCostCents: onHand > 0 ? Math.round(value / onHand) : 0 };
}

/** Would adding this movement keep the whole history valid? Replays everything with it included. */
export function checkAdd(existing: readonly Movement[], candidate: Omit<Movement, "id">): string | null {
  const r = replay([...existing, { ...candidate, id: Number.MAX_SAFE_INTEGER }]);
  return r.ok ? null : r.error;
}

export const isLowStock = (onHand: number, reorderLevel: number | null): boolean => reorderLevel !== null && onHand <= reorderLevel;

const INT = /^\d{1,7}$/;
type Form = Record<string, string | undefined>;

export interface ItemInput { label: string; category: string; unit: string; reorder_level: number | null }
export function parseItemForm(f: Form): { ok: true; value: ItemInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const label = (f.label ?? "").trim(), category = (f.category ?? "").trim() || "General", unit = (f.unit ?? "").trim();
  if (label.length < 1 || label.length > 80) errors.push("Item name: 1 to 80 characters.");
  if (category.length > 40) errors.push("Category: up to 40 characters.");
  if (unit.length < 1 || unit.length > 20) errors.push("Unit (box, pack, each): 1 to 20 characters.");
  const r = parseReorder(f.reorder_level);
  if (r === "bad") errors.push("Reorder level: a whole number, or leave empty for no alert.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { label, category, unit, reorder_level: r as number | null } };
}
export function parseReorder(raw: string | undefined): number | null | "bad" {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  return INT.test(s) && Number(s) <= 1_000_000 ? Number(s) : "bad";
}

export interface MovementInput { item_id: number; moved_on: string; kind: Kind; quantity: number; unit_cost_cents: number | null; reason: Reason | null; lot_number: string | null; expires_on: string | null }
export function parseMovementForm(f: Form): { ok: true; value: MovementInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const item_id = /^\d{1,12}$/.test(f.item_id ?? "") ? Number(f.item_id) : null;
  if (item_id === null) errors.push("Item: not found.");
  const moved_on = parseDate(f.moved_on);
  if (!moved_on) errors.push("Date: use a real date.");
  const kind = f.kind as Kind;
  if (!KINDS.some((k) => k.id === kind)) errors.push("Type: choose one.");
  const qs = (f.quantity ?? "").trim();
  const quantity = INT.test(qs) ? Number(qs) : 0;
  if (quantity < 1 || quantity > 1_000_000) errors.push("Quantity: a whole number from 1 to 1,000,000.");
  const costed = kind === "opening" || kind === "purchase";
  let unit_cost_cents: number | null = null;
  if (costed) {
    unit_cost_cents = parseCents(f.unit_cost);
    if (unit_cost_cents === null || unit_cost_cents > 100_000_000) { errors.push("Cost per unit: dollars like 12.99 (use 0 if it was free)."); unit_cost_cents = null; }
  }
  let reason: Reason | null = null;
  if (kind === "adjust_up" || kind === "adjust_down") {
    reason = REASONS.some((r) => r.id === f.reason) ? (f.reason as Reason) : null;
    if (!reason) errors.push("Reason: choose one.");
  }
  let lot_number: string | null = null, expires_on: string | null = null;
  const lot = (f.lot_number ?? "").trim(), exp = (f.expires_on ?? "").trim();
  if ((lot || exp) && !costed) errors.push("Lot number and expiry apply to purchases and opening stock only.");
  else {
    if (lot) { if (/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/.test(lot)) lot_number = lot; else errors.push("Lot number: letters, numbers and . _ / - only, up to 40 characters."); }
    if (exp) { expires_on = parseDate(exp); if (!expires_on) errors.push("Expiry date: use a real date."); }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { item_id: item_id!, moved_on: moved_on!, kind, quantity, unit_cost_cents, reason, lot_number, expires_on } };
}
