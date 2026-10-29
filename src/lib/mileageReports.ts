import { CATEGORY_LABELS, isBusiness, mileageSummary, PURPOSE_LABELS, type RateInfo, type Trip } from "./mileage";
import type { Range } from "./dates";
import { fmtAmount, monthName, variance, type Cell, type DocRow, type Period, type ReportDoc } from "./statements";

/*
 * Mileage reports, built from the mileage log (not the ledger). They are kept apart from actual vehicle expenses on purpose: the mileage
 * deduction is an ESTIMATE from miles x the IRS standard rate you set for that tax year, it is never posted as an operating expense, and
 * personal and commuting miles are listed but never counted. Mileage fees charged to customers are income, not part of these figures.
 */
export const MILEAGE_BASIS = "Estimated deduction · standard mileage rate · not posted to the ledger";
const NOTES = [
  "Only business trips count. Personal and commuting miles are shown separately and are never deductible here.",
  "The deduction is an estimate: miles × the standard mileage rate you entered under Tax rules for each trip's tax year (use the rate your preparer confirms). It is not an expense in the books, so it cannot be counted twice. Do not also deduct actual vehicle costs if the standard rate is used.",
  "Estimated miles come from a road-route calculation (city to city unless a street address was used) and stay labelled estimated until you enter actual miles.",
  "Mileage or travel fees charged to customers are income and are kept separate from this deduction.",
];

const txt = (text: string, bold?: boolean): Cell => ({ text, bold });
const num = (n: number, bold?: boolean): Cell => ({ text: String(n), bold });
const mi = (tenths: number, bold?: boolean, href?: string): Cell => ({ text: (tenths / 10).toFixed(1), miles: tenths, bold, href });
const pct = (p: number | null, bold?: boolean): Cell => ({ text: p === null ? "n/a" : `${p.toFixed(1)}%`, percent: p, bold });
const money = (s: { deductionCents: number; ratesMissing: boolean }, bold?: boolean): Cell => (s.ratesMissing ? txt("rate not set", bold) : { text: fmtAmount(s.deductionCents), amount: s.deductionCents, bold });
const R = (cells: Cell[], kind: DocRow["kind"] = "line"): DocRow => ({ kind, cells });
const pctOf = (cur: number, prior: number): number | null => variance(cur, prior).percent;

const SHORT_PURPOSE: Record<string, string> = { patient_visits: "Patient visits", supply_run: "Supply run", lab_dropoff: "Lab drop-off", admin_errand: "Admin errand", other: "Other business" };
const statusText = (t: Trip) => (t.miles_status === "estimated" ? "Estimated, route" : t.distance_source === "odometer" ? "Actual, odometer" : "Actual, typed");
const logHref = (r: Range) => `/accounting/reports/mileage-log?period=custom&from=${r.from}&to=${r.to}`;

export function mileageSummaryDoc(trips: readonly Trip[], rates: Record<number, RateInfo>, period: Period): ReportDoc {
  const cur = mileageSummary(trips, period.range, rates), prev = mileageSummary(trips, period.prev.range, rates);
  const rows: DocRow[] = [];
  const line = (label: string, a: Cell, b: Cell, v?: { amt: Cell; pct: Cell }) => rows.push(R([txt(label), a, b, v?.amt ?? txt(""), v?.pct ?? txt("")]));
  rows.push({ kind: "section", cells: [txt("BUSINESS MILEAGE", true)] });
  line("Number of business trips", num(cur.trips), num(prev.trips), { amt: num(cur.trips - prev.trips), pct: pct(pctOf(cur.trips, prev.trips)) });
  line("Total business miles", mi(cur.miles_tenths, false, logHref(period.range)), mi(prev.miles_tenths, false, logHref(period.prev.range)), { amt: mi(cur.miles_tenths - prev.miles_tenths), pct: pct(pctOf(cur.miles_tenths, prev.miles_tenths)) });
  line("   of which estimated (not confirmed as actual)", mi(cur.estimated_tenths), mi(prev.estimated_tenths));
  rows.push(R([txt("Estimated mileage deduction", true), money(cur, true), money(prev, true), cur.ratesMissing || prev.ratesMissing ? txt("") : { text: fmtAmount(cur.deductionCents - prev.deductionCents), amount: cur.deductionCents - prev.deductionCents, bold: true }, cur.ratesMissing || prev.ratesMissing ? txt("") : pct(pctOf(cur.deductionCents, prev.deductionCents), true)], "total"));
  rows.push({ kind: "blank", cells: [] });
  rows.push({ kind: "section", cells: [txt("NOT DEDUCTIBLE", true)] });
  line("Personal and commuting miles (excluded)", mi(cur.excluded_tenths), mi(prev.excluded_tenths));
  const notes = [...NOTES];
  if (cur.ratesMissing || prev.ratesMissing) notes.unshift("A mileage rate is not set for at least one tax year in this view, so no deduction is shown for it. Set it under Tax rules.");
  else if (cur.unconfirmed || prev.unconfirmed) notes.unshift("A mileage rate used here is not confirmed with your preparer yet.");
  return { id: "mileage-summary", title: "Mileage Summary", subtitle: `${period.label} compared with ${period.prev.label}`, basis: MILEAGE_BASIS, columns: [{ label: "", align: "left" }, { label: period.label, align: "right" }, { label: period.prev.label, align: "right" }, { label: "Change", align: "right" }, { label: "Change %", align: "right" }], rows, notes };
}

export function mileageMonthlyDoc(trips: readonly Trip[], rates: Record<number, RateInfo>, year: number): ReportDoc {
  const rows: DocRow[] = [];
  let prevMiles: number | null = null, missing = false;
  const tot = { miles: 0, trips: 0, cents: 0 };
  for (let m = 1; m <= 12; m++) {
    const first = `${year}-${String(m).padStart(2, "0")}-01`, last = `${year}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, "0")}`;
    const s = mileageSummary(trips, { from: first, to: last }, rates);
    tot.miles += s.miles_tenths; tot.trips += s.trips; tot.cents += s.deductionCents; if (s.ratesMissing) missing = true;
    const v = prevMiles === null ? null : variance(s.miles_tenths, prevMiles);
    rows.push(R([{ text: monthName(year, m), href: logHref({ from: first, to: last }) }, num(s.trips), mi(s.miles_tenths), money(s), v ? mi(v.amount) : txt(""), v ? pct(v.percent) : txt("")]));
    prevMiles = s.miles_tenths;
  }
  rows.push(R([txt(`Total ${year}`, true), num(tot.trips, true), mi(tot.miles, true), money({ deductionCents: tot.cents, ratesMissing: missing }, true), txt(""), txt("")], "total"));
  const notes = [...NOTES];
  if (missing) notes.unshift("A mileage rate is not set for this year, so months with trips show no deduction. Set it under Tax rules.");
  return { id: "mileage-monthly", title: "Monthly Mileage Comparison", subtitle: String(year), basis: MILEAGE_BASIS, columns: [{ label: "Month", align: "left" }, { label: "Trips", align: "right" }, { label: "Business miles", align: "right" }, { label: "Est. deduction", align: "right" }, { label: "Miles vs prior month", align: "right" }, { label: "%", align: "right" }], rows, notes };
}

export function mileageLogDoc(trips: readonly Trip[], range: Range): ReportDoc {
  const inRange = trips.filter((t) => t.driven_on >= range.from && t.driven_on <= range.to).sort((a, b) => a.driven_on.localeCompare(b.driven_on) || a.id - b.id);
  const route = (t: Trip) => `${t.driven_on}  ${t.start_label && t.end_label ? `${t.start_label} to ${t.end_label}` : "(no places saved)"}`;
  const row = (t: Trip): DocRow => R([{ text: route(t), href: `/mileage/${t.id}` }, txt(t.category && t.category !== "business" ? (CATEGORY_LABELS[t.category] ?? t.category) : SHORT_PURPOSE[t.purpose] ?? PURPOSE_LABELS[t.purpose] ?? t.purpose), txt(t.trip_type === "round_trip" ? "Round trip" : "One way"), mi(t.miles_tenths), txt(statusText(t))]);
  const biz = inRange.filter(isBusiness), other = inRange.filter((t) => !isBusiness(t));
  const rows: DocRow[] = [{ kind: "section", cells: [txt("BUSINESS TRIPS", true)] }, ...biz.map(row), R([txt("Total business miles", true), txt(""), txt(""), mi(biz.reduce((t, x) => t + x.miles_tenths, 0), true), txt("")], "total")];
  if (other.length) rows.push({ kind: "blank", cells: [] }, { kind: "section", cells: [txt("NOT DEDUCTIBLE: PERSONAL AND COMMUTING", true)] }, ...other.map(row), R([txt("Total excluded miles", true), txt(""), txt(""), mi(other.reduce((t, x) => t + x.miles_tenths, 0), true), txt("")], "subtotal"));
  return { id: "mileage-log", title: "Mileage Log", subtitle: `${range.from} to ${range.to}`, basis: MILEAGE_BASIS, columns: [{ label: "Date and trip", align: "left" }, { label: "Purpose", align: "right" }, { label: "Type", align: "right" }, { label: "Miles", align: "right" }, { label: "Status", align: "right" }], rows, notes: NOTES };
}

