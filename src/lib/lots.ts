import { addDays, daysBetween } from "./dates";
import { replaySteps, type Movement } from "./inventory";

/*
 * Lots. A lot is an item plus a lot number, created by purchases or opening stock that carry one. Lot on hand = received - used, where
 * "used" comes from allocations that link a use or removal to lots (inventory_lot_uses). The movement ledger and the weighted-average
 * cost are untouched: lots only say WHICH units were used, never what they cost. Stock bought without a lot number is simply "no lot".
 * Uses are deliberately not linked to visits or people, so a lot can be traced to dates and quantities but never to a patient.
 */
export interface LotUse { movement_id: number; lot_number: string; quantity: number }
export interface Lot { lot_number: string; expires_on: string | null; received: number; used: number; onHand: number; firstReceived: string }
export type ExpiryStatus = "expired" | "soon" | "ok" | "none";
export const DEFAULT_WARN_DAYS = 30;

const isIn = (m: Movement) => m.kind === "opening" || m.kind === "purchase";
const isOut = (m: Movement) => m.kind === "use" || m.kind === "adjust_down";
const order = (a: Movement, b: Movement) => (a.moved_on < b.moved_on ? -1 : a.moved_on > b.moved_on ? 1 : a.id - b.id);
/** Earliest expiry first; lots with no expiry last; then oldest received, then lot number. */
const fefo = (a: { expires_on: string | null; firstReceived: string; lot_number: string }, b: typeof a) =>
  (a.expires_on ?? "9999-99-99").localeCompare(b.expires_on ?? "9999-99-99") || a.firstReceived.localeCompare(b.firstReceived) || a.lot_number.localeCompare(b.lot_number);

/** Lots of ONE item. `asOf` limits everything to movements on or before that date. */
export function lotBalances(movements: readonly Movement[], uses: readonly LotUse[], asOf?: string): Lot[] {
  const ms = asOf ? movements.filter((m) => m.moved_on <= asOf) : movements;
  const ids = new Set(ms.map((m) => m.id));
  const lots = new Map<string, Lot>();
  for (const m of [...ms].sort(order)) {
    if (!isIn(m) || !m.lot_number) continue;
    const l = lots.get(m.lot_number) ?? { lot_number: m.lot_number, expires_on: m.expires_on, received: 0, used: 0, onHand: 0, firstReceived: m.moved_on };
    l.received += m.quantity; lots.set(m.lot_number, l);
  }
  for (const u of uses) { const l = ids.has(u.movement_id) ? lots.get(u.lot_number) : undefined; if (l) l.used += u.quantity; }
  return [...lots.values()].map((l) => ({ ...l, onHand: l.received - l.used })).sort(fefo);
}

/** Uses and removals of an item (that has lots) not yet fully assigned to lots. */
export function unassignedRemovals(movements: readonly Movement[], uses: readonly LotUse[]): { movement: Movement; unassigned: number }[] {
  if (!movements.some((m) => isIn(m) && m.lot_number)) return [];
  const got = new Map<number, number>();
  for (const u of uses) got.set(u.movement_id, (got.get(u.movement_id) ?? 0) + u.quantity);
  return [...movements].sort(order).filter(isOut).map((m) => ({ movement: m, unassigned: m.quantity - (got.get(m.id) ?? 0) })).filter((x) => x.unassigned > 0);
}

/** Earliest-expiring-first split of a quantity over lots with stock. `remainder` is what no lot could cover. */
export function suggestAllocation(lots: readonly Lot[], quantity: number): { allocations: { lot_number: string; quantity: number }[]; remainder: number } {
  let left = quantity;
  const allocations: { lot_number: string; quantity: number }[] = [];
  for (const l of [...lots].filter((x) => x.onHand > 0).sort(fefo)) {
    if (left <= 0) break;
    const take = Math.min(left, l.onHand);
    allocations.push({ lot_number: l.lot_number, quantity: take }); left -= take;
  }
  return { allocations, remainder: left };
}

export function validateAllocation(lots: readonly Lot[], allocations: readonly { lot_number: string; quantity: number }[], movementQuantity: number, movedOn: string): string | null {
  let sum = 0;
  const seen = new Set<string>();
  for (const a of allocations) {
    const lot = lots.find((l) => l.lot_number === a.lot_number);
    if (!lot) return `Lot ${a.lot_number} was not found for this item.`;
    if (seen.has(a.lot_number)) return `Lot ${a.lot_number} is listed twice.`;
    seen.add(a.lot_number);
    if (!Number.isInteger(a.quantity) || a.quantity < 1) return "Lot quantities must be whole numbers above zero.";
    if (a.quantity > lot.onHand) return `Lot ${a.lot_number} has only ${lot.onHand} on hand.`;
    if (lot.firstReceived > movedOn) return `Lot ${a.lot_number} had not arrived yet on ${movedOn}.`;
    sum += a.quantity;
  }
  return sum > movementQuantity ? `The lot quantities (${sum}) are more than the amount used (${movementQuantity}).` : null;
}

/** A lot number may only ever carry one expiry date. */
export function checkLotConsistency(existing: readonly Movement[], candidate: { kind: string; lot_number: string | null; expires_on: string | null }): string | null {
  if (!candidate.lot_number || (candidate.kind !== "purchase" && candidate.kind !== "opening")) return null;
  const same = existing.find((m) => isIn(m) && m.lot_number === candidate.lot_number);
  if (same && same.expires_on !== candidate.expires_on) return `Lot ${candidate.lot_number} is already recorded ${same.expires_on ? `with expiry ${same.expires_on}` : "with no expiry"}. A lot number can have only one expiry date.`;
  return null;
}

/**
 * Assigns past uses that have no lot, in date order, earliest-expiring lot first among lots that had arrived by then.
 * Returns only NEW allocation rows; existing ones are respected and never changed.
 */
export function backfillAllocations(movements: readonly Movement[], uses: readonly LotUse[]): LotUse[] {
  const byMove = new Map<number, LotUse[]>();
  for (const u of uses) byMove.set(u.movement_id, [...(byMove.get(u.movement_id) ?? []), u]);
  const lots = new Map<string, { expires_on: string | null; firstReceived: string; lot_number: string; onHand: number }>();
  const out: LotUse[] = [];
  for (const m of [...movements].sort(order)) {
    if (isIn(m) && m.lot_number) {
      const l = lots.get(m.lot_number) ?? { expires_on: m.expires_on, firstReceived: m.moved_on, lot_number: m.lot_number, onHand: 0 };
      l.onHand += m.quantity; lots.set(m.lot_number, l);
    } else if (isOut(m)) {
      let have = 0;
      for (const u of byMove.get(m.id) ?? []) { const l = lots.get(u.lot_number); if (l) l.onHand -= u.quantity; have += u.quantity; }
      let left = m.quantity - have;
      for (const l of [...lots.values()].filter((x) => x.onHand > 0).sort(fefo)) {
        if (left <= 0) break;
        const take = Math.min(left, l.onHand);
        l.onHand -= take; left -= take; out.push({ movement_id: m.id, lot_number: l.lot_number, quantity: take });
      }
    }
  }
  return out;
}

export function expiryStatus(expires_on: string | null, today: string, warnDays: number): ExpiryStatus {
  if (!expires_on) return "none";
  if (expires_on < today) return "expired";
  return expires_on <= addDays(today, warnDays) ? "soon" : "ok";
}

export interface ExpiryAlert { item_id: number; label: string; unit: string; lot_number: string; expires_on: string; onHand: number; status: "expired" | "soon"; daysLeft: number }
export function expiryAlerts(
  items: readonly { id: number; label: string; unit: string }[], movements: readonly Movement[], uses: readonly LotUse[], warn: ReadonlyMap<number, number>, today: string,
): ExpiryAlert[] {
  const out: ExpiryAlert[] = [];
  for (const it of items) {
    const mine = movements.filter((m) => m.item_id === it.id);
    for (const l of lotBalances(mine, uses)) {
      if (l.onHand <= 0 || !l.expires_on) continue;
      const st = expiryStatus(l.expires_on, today, warn.get(it.id) ?? DEFAULT_WARN_DAYS);
      if (st === "expired" || st === "soon") out.push({ item_id: it.id, label: it.label, unit: it.unit, lot_number: l.lot_number, expires_on: l.expires_on, onHand: l.onHand, status: st, daysLeft: daysBetween(today, l.expires_on) });
    }
  }
  return out.sort((a, b) => a.expires_on.localeCompare(b.expires_on));
}

export interface LotHistory { item_id: number; label: string; unit: string; expires_on: string | null; received: { date: string; quantity: number; unit_cost_cents: number | null }[]; used: { date: string; kind: string; quantity: number }[]; onHand: number }
/** Everything known about one lot number across items: dates and quantities only. */
export function lotHistory(lotNumber: string, items: readonly { id: number; label: string; unit: string }[], movements: readonly Movement[], uses: readonly LotUse[]): LotHistory[] {
  const out: LotHistory[] = [];
  for (const it of items) {
    const mine = movements.filter((m) => m.item_id === it.id).sort(order);
    const lot = lotBalances(mine, uses).find((l) => l.lot_number === lotNumber);
    if (!lot) continue;
    const byId = new Map(mine.map((m) => [m.id, m]));
    out.push({
      item_id: it.id, label: it.label, unit: it.unit, expires_on: lot.expires_on, onHand: lot.onHand,
      received: mine.filter((m) => isIn(m) && m.lot_number === lotNumber).map((m) => ({ date: m.moved_on, quantity: m.quantity, unit_cost_cents: m.unit_cost_cents })),
      used: uses.filter((u) => u.lot_number === lotNumber && byId.has(u.movement_id)).map((u) => ({ date: byId.get(u.movement_id)!.moved_on, kind: byId.get(u.movement_id)!.kind, quantity: u.quantity })).sort((a, b) => a.date.localeCompare(b.date)),
    });
  }
  return out;
}

export interface ReportRow {
  item_id: number; label: string; unit: string;
  beginQty: number; beginValue: number; endQty: number; endValue: number;
  openingQty: number; openingValue: number; purchaseQty: number; purchaseValue: number; useQty: number; useValue: number;
  adjUpQty: number; adjUpValue: number; adjDownQty: number; adjDownValue: number; writeOffQty: number; writeOffValue: number;
}
export type Report = { rows: ReportRow[]; totals: ReportRow; problems: string[] };

/** Stock and value at the start and end of a period, and every kind of change in between. Values of removals use the average cost at the time. */
export function inventoryReport(items: readonly { id: number; label: string; unit: string }[], movements: readonly Movement[], from: string, to: string): Report {
  const blank = (item_id: number, label: string, unit: string): ReportRow => ({ item_id, label, unit, beginQty: 0, beginValue: 0, endQty: 0, endValue: 0, openingQty: 0, openingValue: 0, purchaseQty: 0, purchaseValue: 0, useQty: 0, useValue: 0, adjUpQty: 0, adjUpValue: 0, adjDownQty: 0, adjDownValue: 0, writeOffQty: 0, writeOffValue: 0 });
  const rows: ReportRow[] = [], problems: string[] = [];
  for (const it of items) {
    const r = replaySteps(movements.filter((m) => m.item_id === it.id));
    if (!r.ok) { problems.push(`${it.label}: ${r.error}`); continue; }
    const row = blank(it.id, it.label, it.unit);
    let before = { q: 0, v: 0 }, end = { q: 0, v: 0 };
    for (const s of r.steps) {
      const d = s.m.moved_on;
      if (d < from) before = { q: s.onHand, v: s.valueCents };
      if (d <= to) end = { q: s.onHand, v: s.valueCents };
      if (d < from || d > to) continue;
      const q = s.m.quantity;
      if (s.m.kind === "opening") { row.openingQty += q; row.openingValue += s.valueDelta; }
      else if (s.m.kind === "purchase") { row.purchaseQty += q; row.purchaseValue += s.valueDelta; }
      else if (s.m.kind === "use") { row.useQty += q; row.useValue -= s.valueDelta; }
      else if (s.m.kind === "adjust_up") { row.adjUpQty += q; row.adjUpValue += s.valueDelta; }
      else if (s.m.reason === "expired") { row.writeOffQty += q; row.writeOffValue -= s.valueDelta; }
      else { row.adjDownQty += q; row.adjDownValue -= s.valueDelta; }
    }
    row.beginQty = before.q; row.beginValue = before.v; row.endQty = end.q; row.endValue = end.v;
    rows.push(row);
  }
  const totals = blank(0, "Total", "");
  for (const r of rows) for (const k of Object.keys(totals) as (keyof ReportRow)[]) if (typeof totals[k] === "number" && k !== "item_id") (totals[k] as number) += r[k] as number;
  return { rows, totals, problems };
}
