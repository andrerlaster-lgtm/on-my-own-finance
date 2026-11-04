import { parseDate, type Range } from "./dates";

/*
 * Mileage log. One row per trip: date, miles (to a tenth), a fixed purpose, optional odometer readings. No addresses or destinations are
 * stored (a stop could be a patient's home). The estimated deduction = miles x the cents-per-mile rate in that tax year's rules; it is only
 * an estimate until the rate is confirmed with the tax preparer, and whether to use the standard rate at all is the preparer's call.
 */
export const PURPOSES = [
  { id: "patient_visits", label: "Patient visits" },
  { id: "supply_run", label: "Supply run" },
  { id: "lab_dropoff", label: "Lab drop-off" },
  { id: "admin_errand", label: "Admin errand (bank, post office)" },
  { id: "other", label: "Other business" },
] as const;
export type Purpose = (typeof PURPOSES)[number]["id"];
export const PURPOSE_LABELS: Record<string, string> = Object.fromEntries(PURPOSES.map((p) => [p.id, p.label]));

export interface Trip { id: number; driven_on: string; miles_tenths: number; purpose: Purpose; odometer_start: number | null; odometer_end: number | null }
export interface TripInput { driven_on: string; miles_tenths: number; purpose: Purpose; odometer_start: number | null; odometer_end: number | null }

export const formatMiles = (tenths: number): string => (tenths / 10).toFixed(1);

/** "12", "12.5" -> tenths of a mile. At most one decimal place, 0.1 to 1000. */
export function parseMilesTenths(raw: string | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!/^\d{1,4}(\.\d)?$/.test(s)) return null;
  const t = Math.round(Number(s) * 10);
  return t >= 1 && t <= 10000 ? t : null;
}

export function parseTripForm(f: Record<string, string | undefined>): { ok: true; value: TripInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const driven_on = parseDate(f.driven_on);
  if (!driven_on) errors.push("Date: use a real date.");
  const miles = parseMilesTenths(f.miles);
  if (miles === null) errors.push("Miles: 0.1 to 1000, with at most one decimal.");
  const purpose = f.purpose as Purpose;
  if (!PURPOSES.some((p) => p.id === purpose)) errors.push("Purpose: choose one.");
  const s = (f.odometer_start ?? "").trim(), e = (f.odometer_end ?? "").trim();
  let odometer_start: number | null = null, odometer_end: number | null = null;
  if (s !== "" || e !== "") {
    if (!/^\d{1,7}$/.test(s) || !/^\d{1,7}$/.test(e)) errors.push("Odometer: enter both readings as whole numbers, or leave both empty.");
    else if (Number(e) < Number(s)) errors.push("Odometer: the end reading can't be lower than the start.");
    else { odometer_start = Number(s); odometer_end = Number(e); }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { driven_on: driven_on!, miles_tenths: miles!, purpose, odometer_start, odometer_end } };
}

/** h2 = an optional second rate for trips dated July 1 or later (the IRS changed the 2026 business rate mid-year). */
export interface RateInfo { centsPerMile: number | null; confirmed: boolean; h2CentsPerMile?: number | null; h2Confirmed?: boolean }

/** The rate that applies to a trip on this date: the July 1 rate when one is set, otherwise the year's rate. */
export function rateForDate(r: RateInfo, date: string): { cents: number | null; confirmed: boolean } {
  const month = Number(date.slice(5, 7));
  if (month >= 7 && r.h2CentsPerMile !== undefined && r.h2CentsPerMile !== null) return { cents: r.h2CentsPerMile, confirmed: Boolean(r.h2Confirmed) };
  return { cents: r.centsPerMile, confirmed: r.confirmed };
}
export interface MileageSummary { miles_tenths: number; trips: number; deductionCents: number; ratesMissing: boolean; unconfirmed: boolean }

/** Deduction per trip uses the rate of that trip's own tax year (and its July 1 rate, when set, for trips from July 1). Trips in a year with no rate add miles but no dollars, and set ratesMissing. */
export function mileageSummary(trips: readonly Trip[], range: Range, rates: Record<number, RateInfo>): MileageSummary {
  const s: MileageSummary = { miles_tenths: 0, trips: 0, deductionCents: 0, ratesMissing: false, unconfirmed: false };
  for (const t of trips) {
    if (t.driven_on < range.from || t.driven_on > range.to) continue;
    s.miles_tenths += t.miles_tenths; s.trips++;
    const r = rates[Number(t.driven_on.slice(0, 4))];
    const used = r ? rateForDate(r, t.driven_on) : null;
    if (!used || used.cents === null) { s.ratesMissing = true; continue; }
    if (!used.confirmed) s.unconfirmed = true;
    s.deductionCents += Math.round((t.miles_tenths * used.cents) / 10);
  }
  return s;
}

/* ---- Temporary stops: typed while driving, kept until the end of the next day, then erased. Only used to work out the miles. ---- */
export interface PendingTrip { id: number; driven_on: string; start_text: string; end_text: string; purpose: Purpose }

/** A stop is free text (a street, a business, "home"), but never a long digit run (phone, card or ID numbers) or an email. */
export function cleanStop(raw: string | undefined): string | null {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  if (v.length < 1 || v.length > 120 || !/^[A-Za-z0-9 .,&'#/():;-]+$/.test(v) || /\d{6,}/.test(v.replace(/[ -]/g, ""))) return null;
  return v;
}

export function parsePendingForm(f: Record<string, string | undefined>): { ok: true; value: Omit<PendingTrip, "id"> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const driven_on = parseDate(f.driven_on), start_text = cleanStop(f.start_text), end_text = cleanStop(f.end_text);
  const purpose = f.purpose as Purpose;
  if (!driven_on) errors.push("Date: use a real date.");
  if (!start_text) errors.push("Start: up to 120 characters (letters, numbers, spaces and . , & ' # / ( ) : ;). No phone numbers or long numbers.");
  if (!end_text) errors.push("End: up to 120 characters (letters, numbers, spaces and . , & ' # / ( ) : ;). No phone numbers or long numbers.");
  if (!PURPOSES.some((p) => p.id === purpose)) errors.push("Purpose: choose one.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { driven_on: driven_on!, start_text: start_text!, end_text: end_text!, purpose } };
}
