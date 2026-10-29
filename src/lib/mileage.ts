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

export type TripCategory = "business" | "personal" | "commuting";
export type TripType = "one_way" | "round_trip";
export type MilesStatus = "estimated" | "actual";
export type DistanceSource = "manual" | "odometer" | "route_city" | "route_address";
export const CATEGORY_CHOICES: { id: TripCategory; label: string }[] = [{ id: "business", label: "Business" }, { id: "personal", label: "Personal" }, { id: "commuting", label: "Commuting" }];
export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(CATEGORY_CHOICES.map((c) => [c.id, c.label]));
export const SOURCE_LABELS: Record<string, string> = { manual: "Entered by you", odometer: "Odometer readings", route_city: "Road-route estimate, city to city", route_address: "Road-route estimate, with street address" };

/** miles_tenths is always the TOTAL miles counted for the trip (both ways for a round trip). Old rows read as business trips with typed miles. */
export interface Trip {
  id: number; driven_on: string; miles_tenths: number; purpose: Purpose; odometer_start: number | null; odometer_end: number | null;
  start_label?: string | null; end_label?: string | null; trip_type?: TripType; category?: TripCategory; one_way_est_tenths?: number | null;
  miles_status?: MilesStatus; distance_source?: DistanceSource; remarks?: string | null;
}
export const isBusiness = (t: Pick<Trip, "category">): boolean => (t.category ?? "business") === "business";
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
export interface MileageSummary { miles_tenths: number; trips: number; deductionCents: number; ratesMissing: boolean; unconfirmed: boolean; estimated_tenths: number; excluded_tenths: number }

/** Only business trips count. Deduction per trip uses the rate of that trip's own tax year (and its July 1 rate, when set, for trips from July 1). Trips in a year with no rate add miles but no dollars, and set ratesMissing. */
export function mileageSummary(trips: readonly Trip[], range: Range, rates: Record<number, RateInfo>): MileageSummary {
  const s: MileageSummary = { miles_tenths: 0, trips: 0, deductionCents: 0, ratesMissing: false, unconfirmed: false, estimated_tenths: 0, excluded_tenths: 0 };
  for (const t of trips) {
    if (t.driven_on < range.from || t.driven_on > range.to) continue;
    if (!isBusiness(t)) { s.excluded_tenths += t.miles_tenths; continue; } // personal and commuting miles are never deductible
    s.miles_tenths += t.miles_tenths; s.trips++;
    if (t.miles_status === "estimated") s.estimated_tenths += t.miles_tenths;
    const r = rates[Number(t.driven_on.slice(0, 4))];
    const used = r ? rateForDate(r, t.driven_on) : null;
    if (!used || used.cents === null) { s.ratesMissing = true; continue; }
    if (!used.confirmed) s.unconfirmed = true;
    s.deductionCents += Math.round((t.miles_tenths * used.cents) / 10);
  }
  return s;
}

/* ---- The trip form: from/to cities, one-way or round trip, estimate and optional actual miles ---- */
/** "abilene tx" is not accepted; "Abilene, TX" or "Abilene" are. City level only, so a saved trip never holds a street address. */
export function cleanCity(raw: string | undefined): string | null {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  const m = /^([A-Za-z][A-Za-z .'-]{1,50}?)(?:\s*,\s*([A-Za-z]{2}))?$/.exec(v);
  if (!m) return null;
  return m[2] ? `${m[1].trim()}, ${m[2].toUpperCase()}` : m[1].trim();
}
/** A street address typed only to sharpen a route estimate. It is sent to the routing service and never saved. */
export function cleanStreet(raw: string | undefined): string | null {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  if (v === "") return "";
  return v.length <= 80 && /^[A-Za-z0-9 .,&'#/()-]+$/.test(v) && !/\d{6,}/.test(v.replace(/[ -]/g, "")) ? v : null;
}
export function cleanRemarks(raw: string | undefined): string | null {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  return v.length <= 200 && /^[A-Za-z0-9 .,&'#/():;!?%$+-]*$/.test(v) && !/\d{6,}/.test(v.replace(/[ -]/g, "")) ? v : null;
}

export interface TripEntry {
  driven_on: string; start_label: string; end_label: string; purpose: Purpose; trip_type: TripType; category: TripCategory;
  one_way_est_tenths: number | null; miles_tenths: number; miles_status: MilesStatus; distance_source: DistanceSource; remarks: string | null;
  odometer_start: number | null; odometer_end: number | null;
}

/**
 * Total miles counted: the actual miles you typed (a total for the whole trip) win; otherwise the road estimate (doubled for a round trip),
 * otherwise the odometer difference. An estimate stays labelled "estimated" until you type actual miles.
 */
export function parseTripEntry(f: Record<string, string | undefined>): { ok: true; value: TripEntry } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const driven_on = parseDate(f.driven_on), start = cleanCity(f.start_label), end = cleanCity(f.end_label), remarks = cleanRemarks(f.remarks);
  if (!driven_on) errors.push("Date: use a real date.");
  if (!start) errors.push("Starting location: a city like Abilene, TX (letters only; keep street addresses out of this field).");
  if (!end) errors.push("Destination: a city like Dallas, TX (letters only; keep street addresses out of this field).");
  const purpose = f.purpose as Purpose;
  if (!PURPOSES.some((p) => p.id === purpose)) errors.push("Business purpose: choose one.");
  const trip_type: TripType = f.trip_type === "round_trip" ? "round_trip" : "one_way";
  const category = (CATEGORY_CHOICES.some((c) => c.id === f.category) ? f.category : "business") as TripCategory;
  if (remarks === null) errors.push("Notes: up to 200 characters, no phone numbers or long numbers.");
  const estRaw = (f.estimate_tenths ?? "").trim();
  let est: number | null = null;
  if (estRaw !== "") { est = /^\d{1,5}$/.test(estRaw) && Number(estRaw) >= 1 && Number(estRaw) <= 10000 ? Number(estRaw) : null; if (est === null) errors.push("Estimated miles: not a valid number. Calculate again or type the miles yourself."); }
  const estSource = f.estimate_source === "route_address" ? "route_address" : "route_city";
  const actualRaw = (f.actual_miles ?? "").trim();
  const actual = actualRaw === "" ? null : parseMilesTenths(actualRaw);
  if (actualRaw !== "" && actual === null) errors.push("Actual miles: 0.1 to 1000, with at most one decimal.");
  const os = (f.odometer_start ?? "").trim(), oe = (f.odometer_end ?? "").trim();
  let odometer_start: number | null = null, odometer_end: number | null = null;
  if (os !== "" || oe !== "") {
    if (!/^\d{1,7}$/.test(os) || !/^\d{1,7}$/.test(oe)) errors.push("Odometer: enter both readings as whole numbers, or leave both empty.");
    else if (Number(oe) < Number(os)) errors.push("Odometer: the end reading can't be lower than the start.");
    else { odometer_start = Number(os); odometer_end = Number(oe); }
  }
  let miles: number | null = null, status: MilesStatus = "actual", source: DistanceSource = "manual";
  if (actual !== null) { miles = actual; }
  else if (est !== null) { miles = est * (trip_type === "round_trip" ? 2 : 1); status = "estimated"; source = estSource; }
  else if (odometer_start !== null && odometer_end !== null && odometer_end - odometer_start >= 1) { miles = (odometer_end - odometer_start) * 10; source = "odometer"; }
  else if (!errors.length) errors.push("Miles: calculate an estimate, or type the actual miles.");
  if (miles !== null && miles > 10000) errors.push("Total miles can't be more than 1,000 for one trip. Split it into separate trips.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { driven_on: driven_on!, start_label: start!, end_label: end!, purpose, trip_type, category, one_way_est_tenths: est, miles_tenths: miles!, miles_status: status, distance_source: source, remarks: remarks || null, odometer_start, odometer_end } };
}

/** Same date, cities, direction and miles as a trip already saved (the page asks before saving it twice). */
export function findDuplicate(existing: readonly Trip[], e: TripEntry, ignoreId?: number): Trip | null {
  return existing.find((t) => t.id !== ignoreId && t.driven_on === e.driven_on && (t.start_label ?? "") === e.start_label && (t.end_label ?? "") === e.end_label && (t.trip_type ?? "one_way") === e.trip_type && t.miles_tenths === e.miles_tenths) ?? null;
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
