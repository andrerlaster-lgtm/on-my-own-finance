import { parseCents } from "./money";
import { parseDate, type Range } from "./dates";
import type { ExpenseInput } from "./expenses";

/*
 * Vehicles. Actual vehicle spending (fuel, service, repairs, tires, insurance, parking and tolls) is stored as an ordinary expense row
 * (category "vehicle_fuel", the books category for all vehicle costs) plus one detail row saying which vehicle and what kind of cost.
 * Because it is ONE expense row, the ledger (which is calculated from expense rows) posts it exactly once, and receipts, backups and exports
 * work as they already do.
 *
 * Books vs. taxes: the ledger and the Profit & Loss show what was actually spent, in full. Tax estimates (dashboard profit, set-aside, year-end packet)
 * follow the year's rule below: parking and tolls are always counted; other vehicle costs only under "actual expenses" with a confirmed business-use
 * percentage; and under actual expenses the mileage deduction is not applied. Nothing here is tax advice.
 *
 * Upcoming maintenance and its estimated cost live only in vehicle_maintenance. Nothing reads them into the ledger; only a paid expense does.
 * No plate, VIN, driver, patient or address fields exist. Vehicle labels and service titles are short plain text.
 */
export const VEHICLE_EXPENSE_CATEGORY = "vehicle_fuel";

export const VEHICLE_CATEGORIES = [
  { id: "fuel", label: "Fuel" },
  { id: "maintenance", label: "Maintenance and service" },
  { id: "repairs", label: "Repairs" },
  { id: "tires", label: "Tires" },
  { id: "insurance", label: "Vehicle insurance" },
  { id: "parking_tolls", label: "Parking and tolls" },
] as const;
export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number]["id"];
export const VEHICLE_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(VEHICLE_CATEGORIES.map((c) => [c.id, c.label]));

export const TAX_METHODS = [
  { id: "standard_mileage", label: "Standard mileage rate (fuel, service, repairs, tires, insurance not counted; parking and tolls are)" },
  { id: "actual", label: "Actual expenses (business-use share of costs counted; mileage deduction not applied)" },
] as const;
export type TaxMethod = (typeof TAX_METHODS)[number]["id"];
export const isTaxMethod = (v: unknown): v is TaxMethod => v === "standard_mileage" || v === "actual";

export const isVehicleCost = (e: { category: string }): boolean => e.category === VEHICLE_EXPENSE_CATEGORY;

/**
 * How a year's vehicle costs are treated in tax ESTIMATES (the books always carry every cost at its full amount):
 *  - Parking and tolls are counted in full under EITHER method. They are separate from the mileage rate and stay separately identifiable.
 *  - Under standard mileage, every other vehicle cost (fuel, service, repairs, tires, insurance) is left out: the rate already covers them.
 *  - Under actual expenses, those other costs are counted only after a business-use percentage is entered AND confirmed with the preparer, and
 *    only that percentage of each cost is counted. With no confirmed percentage they are not counted at all. The mileage deduction is not applied.
 */
export interface VehicleTaxRule { method: TaxMethod; businessUsePercent: number | null; businessUseConfirmed: boolean }
export const STANDARD_RULE: VehicleTaxRule = { method: "standard_mileage", businessUsePercent: null, businessUseConfirmed: false };
export type AllocationStatus = "standard" | "needs_percent" | "needs_confirmation" | "applied";

export function allocationStatus(r: VehicleTaxRule): AllocationStatus {
  if (r.method !== "actual") return "standard";
  if (r.businessUsePercent === null) return "needs_percent";
  return r.businessUseConfirmed ? "applied" : "needs_confirmation";
}
export const parseBusinessUse = (raw: string | undefined): number | null | "bad" => {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s) || Number(s) > 100) return "bad";
  return Number(s);
};
/** The business-use share of an amount, in whole cents (percent has at most two decimals). */
export const allocate = (amountCents: number, percent: number): number => Math.round((amountCents * Math.round(percent * 100)) / 10000);

export const isParkingTolls = (e: { category: string; vehicle_category?: string | null }): boolean => isVehicleCost(e) && e.vehicle_category === "parking_tolls";

/** Cents of one vehicle cost that tax estimates may use under a rule. */
export function countedCents(amountCents: number, vehicleCategory: string | null | undefined, rule: VehicleTaxRule): number {
  if (vehicleCategory === "parking_tolls") return amountCents;
  return allocationStatus(rule) === "applied" ? allocate(amountCents, rule.businessUsePercent as number) : 0;
}

/** Expenses that tax estimates may use. Vehicle rows are kept (at their counted amount) or dropped; everything else passes through untouched. The books are never changed. */
export function taxExpenses<T extends { category: string; spent_on: string; amount_cents: number; vehicle_category?: string | null }>(list: readonly T[], ruleFor: (year: number) => VehicleTaxRule): T[] {
  const out: T[] = [];
  for (const e of list) {
    if (!isVehicleCost(e)) { out.push(e); continue; }
    const c = countedCents(e.amount_cents, e.vehicle_category, ruleFor(Number(e.spent_on.slice(0, 4))));
    if (c > 0) out.push(c === e.amount_cents ? e : { ...e, amount_cents: c });
  }
  return out;
}

/** Actual vehicle spending vs. what tax estimates use, for one year's vehicle costs and rule. Spending is never reduced. */
export function vehicleTaxSummary(rows: readonly { amount_cents: number; vehicle_category?: string | null }[], rule: VehicleTaxRule) {
  let spending = 0, counted = 0, parkingTolls = 0;
  for (const r of rows) { spending += r.amount_cents; counted += countedCents(r.amount_cents, r.vehicle_category, rule); if (r.vehicle_category === "parking_tolls") parkingTolls += r.amount_cents; }
  const status = allocationStatus(rule);
  return {
    method: rule.method, allocation: status, businessUsePercent: rule.businessUsePercent, businessUseConfirmed: rule.businessUseConfirmed,
    actualSpendingCents: spending, parkingTollsCents: parkingTolls, countedInTaxEstimatesCents: counted, notCountedCents: spending - counted,
    mileageApplies: rule.method === "standard_mileage",
    warning: rule.method !== "actual" ? null : status === "applied"
      ? `Actual expenses: ${rule.businessUsePercent}% business use applied to fuel, service, repairs, tires and insurance. The mileage deduction is not applied. Your preparer decides what is deductible.`
      : status === "needs_percent" ? "Actual expenses is selected but no business-use percentage is entered, so these costs are not counted yet (parking and tolls still are). The mileage deduction is not applied."
      : "The business-use percentage is entered but not confirmed with your preparer, so these costs are not counted yet (parking and tolls still are). The mileage deduction is not applied.",
  };
}

/* ---- text cleaning: short plain text only (no personal details, no long numbers, no VIN-like strings) ---- */
export function cleanText(raw: string | undefined, max: number): string | null | "bad" {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  if (v === "") return null;
  if (v.length > max || !/^[A-Za-z0-9 .,&'#/()-]+$/.test(v) || /\d{5,}/.test(v.replace(/[ -]/g, "")) || /\b[A-Za-z0-9]{17}\b/.test(v)) return "bad";
  return v;
}

const posInt = (raw: string | undefined): number | null => (/^\d{1,12}$/.test((raw ?? "").trim()) && Number(raw) > 0 ? Number(raw) : null);
function parseOdometer(raw: string | undefined, errors: string[], label = "Odometer"): number | null {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  if (!/^\d{1,7}$/.test(s)) { errors.push(`${label}: whole miles, up to 7 digits, or leave empty.`); return null; }
  return Number(s);
}

export type Ok<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function parseVehicleForm(f: Record<string, string | undefined>): Ok<{ label: string }> {
  const label = cleanText(f.label, 40);
  if (label === null || label === "bad") return { ok: false, errors: ["Vehicle name: a short name like “Work car” (letters, numbers, spaces and . , & ' # / ( ) -, up to 40). No plate or VIN numbers."] };
  return { ok: true, value: { label } };
}

export interface VehicleExpenseInput { vehicle_id: number; expense: ExpenseInput; vehicle_category: VehicleCategory; odometer: number | null }

/** Shared cost fields: date, amount, category, vendor, receipt. `dateField` names the date input. */
function parseCost(f: Record<string, string | undefined>, dateField: string, errors: string[]) {
  const spent_on = parseDate(f[dateField]);
  if (!spent_on) errors.push("Date: use a real date.");
  const amount = parseCents(f.amount);
  if (amount === null || amount === 0) errors.push("Amount: dollars greater than zero, like 24.99.");
  const category = f.vehicle_category as VehicleCategory;
  if (!VEHICLE_CATEGORIES.some((c) => c.id === category)) errors.push("Category: choose one.");
  const vendor = cleanText(f.vendor, 60);
  if (vendor === "bad") errors.push("Vendor: a short business name (letters, numbers, spaces and . , & ' - # /). No personal details or long numbers.");
  return { spent_on, amount, category, vendor: vendor === "bad" ? null : vendor, receipt_on_file: f.receipt_on_file === "on" };
}

export function parseVehicleExpenseForm(f: Record<string, string | undefined>): Ok<VehicleExpenseInput> {
  const errors: string[] = [];
  const vehicle_id = posInt(f.vehicle_id);
  if (!vehicle_id) errors.push("Vehicle: choose one.");
  const c = parseCost(f, "spent_on", errors);
  const odometer = parseOdometer(f.odometer, errors);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { vehicle_id: vehicle_id!, vehicle_category: c.category, odometer, expense: { spent_on: c.spent_on!, amount_cents: c.amount!, category: VEHICLE_EXPENSE_CATEGORY as ExpenseInput["category"], vendor: c.vendor, receipt_on_file: c.receipt_on_file } } };
}

/** A completed service or repair. The cost is optional: leave the amount empty for a free or already-recorded service. */
export interface ServiceInput {
  maintenance_id: number | null; vehicle_id: number; title: string; done_on: string; odometer: number | null;
  cost: null | { amount_cents: number; vehicle_category: VehicleCategory; vendor: string | null; receipt_on_file: boolean };
}

export function parseServiceForm(f: Record<string, string | undefined>, fromPlanned: boolean): Ok<ServiceInput> {
  const errors: string[] = [];
  const maintenance_id = fromPlanned ? posInt(f.maintenance_id) : null;
  if (fromPlanned && !maintenance_id) errors.push("Upcoming item not found.");
  const vehicle_id = fromPlanned ? 0 : posInt(f.vehicle_id);
  if (!fromPlanned && !vehicle_id) errors.push("Vehicle: choose one.");
  let title: string | null = null;
  if (!fromPlanned) {
    const t = cleanText(f.title, 60);
    if (t === null || t === "bad") errors.push("What was done: a short description like “Oil change” (letters, numbers, spaces and . , & ' # / ( ) -, up to 60).");
    else title = t;
  }
  const done_on = parseDate(f.done_on);
  if (!done_on) errors.push("Date: use a real date.");
  const odometer = parseOdometer(f.odometer, errors);
  let cost: ServiceInput["cost"] = null;
  if ((f.amount ?? "").trim() !== "") {
    const c = parseCost({ ...f, spent_on: f.done_on }, "spent_on", errors);
    if (!errors.length) cost = { amount_cents: c.amount!, vehicle_category: c.category, vendor: c.vendor, receipt_on_file: c.receipt_on_file };
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { maintenance_id, vehicle_id: vehicle_id ?? 0, title: title ?? "", done_on: done_on!, odometer, cost } };
}

export interface PlannedInput { vehicle_id: number; title: string; due_on: string | null; due_odometer: number | null; estimated_cost_cents: number | null }

export function parsePlannedForm(f: Record<string, string | undefined>): Ok<PlannedInput> {
  const errors: string[] = [];
  const vehicle_id = posInt(f.vehicle_id);
  if (!vehicle_id) errors.push("Vehicle: choose one.");
  const title = cleanText(f.title, 60);
  if (title === null || title === "bad") errors.push("What is due: a short description like “Tire rotation” (letters, numbers, spaces and . , & ' # / ( ) -, up to 60).");
  let due_on: string | null = null;
  if ((f.due_on ?? "").trim() !== "") { due_on = parseDate(f.due_on); if (!due_on) errors.push("Due date: use a real date, or leave empty."); }
  const due_odometer = parseOdometer(f.due_odometer, errors, "Due at odometer");
  if (due_on === null && due_odometer === null && !errors.length) errors.push("Give a due date, a due odometer reading, or both.");
  let estimated: number | null = null;
  if ((f.estimate ?? "").trim() !== "") { estimated = parseCents(f.estimate); if (estimated === null) errors.push("Estimated cost: dollars like 120.00, or leave empty."); }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { vehicle_id: vehicle_id!, title: title as string, due_on, due_odometer, estimated_cost_cents: estimated } };
}

/* ---- upcoming maintenance status ---- */
export interface PlannedItem { id: number; vehicle_id: number; title: string; due_on: string | null; due_odometer: number | null; estimated_cost_cents: number | null }
export type DueStatus = "overdue" | "due_soon" | "upcoming";
export const DUE_SOON_DAYS = 30, DUE_SOON_MILES = 500;

const dayNumber = (d: string): number => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000;

/** odometerNow = the highest reading recorded for that vehicle (from its expenses and service log), or null when none is known. */
export function dueStatus(item: Pick<PlannedItem, "due_on" | "due_odometer">, today: string, odometerNow: number | null): DueStatus {
  const daysLeft = item.due_on ? dayNumber(item.due_on) - dayNumber(today) : null;
  const milesLeft = item.due_odometer !== null && odometerNow !== null ? item.due_odometer - odometerNow : null;
  if ((daysLeft !== null && daysLeft < 0) || (milesLeft !== null && milesLeft <= 0)) return "overdue";
  if ((daysLeft !== null && daysLeft <= DUE_SOON_DAYS) || (milesLeft !== null && milesLeft <= DUE_SOON_MILES)) return "due_soon";
  return "upcoming";
}

/** Estimated cost of items still planned. A planning figure only: it is never posted anywhere. */
export const plannedEstimateTotal = (items: readonly Pick<PlannedItem, "estimated_cost_cents">[]): number => items.reduce((s, i) => s + (i.estimated_cost_cents ?? 0), 0);

/* ---- spending totals ---- */
export interface SpendRow { spent_on: string; amount_cents: number; vehicle_id: number; vehicle_category: string }
export interface SpendTotals {
  total: number; count: number;
  byVehicle: { vehicle_id: number; total: number; count: number; byCategory: Record<string, number> }[];
  byCategory: { id: string; total: number; count: number }[];
}

export function spendingTotals(rows: readonly SpendRow[], range: Range): SpendTotals {
  const v = new Map<number, { vehicle_id: number; total: number; count: number; byCategory: Record<string, number> }>();
  const c = new Map<string, { id: string; total: number; count: number }>();
  let total = 0, count = 0;
  for (const r of rows) {
    if (r.spent_on < range.from || r.spent_on > range.to) continue;
    total += r.amount_cents; count++;
    const ve = v.get(r.vehicle_id) ?? { vehicle_id: r.vehicle_id, total: 0, count: 0, byCategory: {} };
    ve.total += r.amount_cents; ve.count++; ve.byCategory[r.vehicle_category] = (ve.byCategory[r.vehicle_category] ?? 0) + r.amount_cents; v.set(r.vehicle_id, ve);
    const ce = c.get(r.vehicle_category) ?? { id: r.vehicle_category, total: 0, count: 0 };
    ce.total += r.amount_cents; ce.count++; c.set(r.vehicle_category, ce);
  }
  return { total, count, byVehicle: [...v.values()].sort((a, b) => b.total - a.total || a.vehicle_id - b.vehicle_id), byCategory: [...c.values()].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id)) };
}

/** Twelve month totals (index 0 = January) for one year. */
export function monthlyTotals(rows: readonly SpendRow[], year: number): number[] {
  const out = new Array<number>(12).fill(0);
  for (const r of rows) if (r.spent_on.startsWith(`${year}-`)) out[Number(r.spent_on.slice(5, 7)) - 1] += r.amount_cents;
  return out;
}

/** Last day of a month, for ranges: monthRange(2026, 2) -> 2026-02-01 .. 2026-02-28. */
export function monthRange(year: number, month: number): Range {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}
