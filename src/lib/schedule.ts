import { addDays, parseDate } from "./dates";

/*
 * Secretary: appointments (Phase 1A, internal only). Pure logic; the database and pages call it.
 *
 * Time: every appointment is a real instant (UTC in the database, timestamptz) shown in America/Chicago. A visit that lasts 60 minutes is 60 real
 * minutes even across a daylight-saving change. Typed local times are converted with the zone's rules: a time that does not exist (the spring
 * "skipped hour") is refused; a time that happens twice (the fall "repeated hour") is taken as its FIRST occurrence (daylight time) and the screen
 * shows CDT or CST so it is never ambiguous.
 *
 * Privacy: appointments hold NO patient names, phone numbers, addresses, birth dates or medical details, and there is no free-text field.
 * Everything is a fixed choice (type, service, status, cancel reason) or a number/time. An appointment is shown as "Appointment #id".
 * Nothing here touches money: completing an appointment records no revenue and changes no inventory.
 */
export const TIME_ZONE = "America/Chicago";

export const APPOINTMENT_TYPES = [
  { id: "office", label: "Office" },
  { id: "mobile", label: "Mobile" },
] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number]["id"];
export const TYPE_LABELS: Record<string, string> = Object.fromEntries(APPOINTMENT_TYPES.map((t) => [t.id, t.label]));

export const STATUSES = [
  { id: "scheduled", label: "Scheduled" },
  { id: "confirmed", label: "Confirmed" },
  { id: "completed", label: "Completed" },
  { id: "canceled", label: "Canceled" },
] as const;
export type Status = (typeof STATUSES)[number]["id"];
export const STATUS_LABELS: Record<string, string> = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
export const isStatus = (v: unknown): v is Status => STATUSES.some((s) => s.id === v);

/** Fixed reasons only (no free text, so nothing personal can be typed). */
export const CANCEL_REASONS = [
  { id: "requested", label: "Requested by the customer" },
  { id: "no_show", label: "No-show" },
  { id: "rescheduled", label: "Moved to another time" },
  { id: "unavailable", label: "We were unavailable" },
  { id: "other", label: "Other" },
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number]["id"];
export const CANCEL_REASON_LABELS: Record<string, string> = Object.fromEntries(CANCEL_REASONS.map((r) => [r.id, r.label]));

/** Starting service list (seeded into appointment_services; generic service types only). The database table is the source of truth. */
export const DEFAULT_SERVICES = [
  { code: "blood_draw", label: "Blood draw", default_minutes: 30, sort: 10 },
  { code: "specimen_collection", label: "Specimen collection", default_minutes: 30, sort: 20 },
  { code: "specimen_delivery", label: "Specimen pickup or delivery", default_minutes: 30, sort: 30 },
  { code: "consultation", label: "Consultation", default_minutes: 30, sort: 40 },
  { code: "other_service", label: "Other service", default_minutes: 30, sort: 90 },
] as const;
export interface Service { code: string; label: string; default_minutes: number; active: boolean }

export const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240] as const;
export const MAX_MINUTES = 12 * 60;

export interface Appointment {
  id: number; type: AppointmentType; status: Status; service_code: string;
  starts_at: number; ends_at: number; // milliseconds since 1970 (UTC instants)
  cancel_reason: CancelReason | null; source: string; external_ref: string | null;
}

/* ---------------- time zone ---------------- */
const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const abbr = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, timeZoneName: "short" });

/** Minutes the zone is ahead of UTC at this instant (Chicago: -300 in summer, -360 in winter). */
export function offsetMinutesAt(ms: number): number {
  const p = Object.fromEntries(parts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

export interface Local { date: string; time: string; zone: "CST" | "CDT" }
export function toLocal(ms: number): Local {
  const p = Object.fromEntries(parts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const zone = abbr.formatToParts(new Date(ms)).find((x) => x.type === "timeZoneName")?.value === "CDT" ? "CDT" : "CST";
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, zone };
}

export type LocalResult = { ok: true; ms: number; ambiguous: boolean } | { ok: false; error: string };

/** "2026-11-01" + "01:30" in Chicago -> the instant. See the note at the top for the two daylight-saving edge cases. */
export function fromLocal(date: string, time: string): LocalResult {
  const d = parseDate(date);
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((time ?? "").trim());
  if (!d || !m) return { ok: false, error: "Use a real date and a time like 09:30." };
  const [y, mo, da] = d.split("-").map(Number);
  const wall = Date.UTC(y, mo - 1, da, Number(m[1]), Number(m[2]));
  // local = utc + offset, so utc = local - offset. An offset is right only if the zone really has that offset at that instant.
  const ok = [-300, -360].map((off) => ({ off, ms: wall - off * 60000 })).filter((c) => offsetMinutesAt(c.ms) === c.off).map((c) => c.ms).sort((x, y) => x - y);
  if (ok.length === 0) return { ok: false, error: "That time does not exist on that day (clocks skip an hour in the spring). Pick another time." };
  return { ok: true, ms: ok[0], ambiguous: ok.length > 1 };
}

/** UTC bounds [from, to) of one Chicago calendar day (23 or 25 hours long on the daylight-saving days). */
export function dayBounds(date: string): { from: number; to: number } {
  const next = addDays(date, 1);
  const a = fromLocal(date, "00:00"), b = fromLocal(next, "00:00");
  if (!a.ok || !b.ok) throw new Error("Midnight always exists in this zone.");
  return { from: a.ms, to: b.ms };
}

/** The Chicago calendar date an instant falls on. */
export const dateOf = (ms: number): string => toLocal(ms).date;

/** Monday of the week containing this date (weeks run Monday to Sunday, like the rest of the app). */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}
export const weekDates = (date: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i));

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${MONTHS[m - 1]} ${d}`;
}
/** "9:30 AM" (12-hour, no leading zero) for an "HH:MM" value. */
export function clock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
/** "9:30 AM to 10:00 AM CDT" */
export function rangeLabel(a: Pick<Appointment, "starts_at" | "ends_at">): string {
  const s = toLocal(a.starts_at), e = toLocal(a.ends_at);
  return `${clock(s.time)} to ${clock(e.time)} ${e.zone}${s.zone !== e.zone ? ` (starts ${s.zone})` : ""}`;
}
export const minutesOf = (a: Pick<Appointment, "starts_at" | "ends_at">): number => Math.round((a.ends_at - a.starts_at) / 60000);

/* ---------------- overlaps ---------------- */
/** Half-open ranges: one that ends exactly when the next begins does not overlap. Canceled appointments never block anything. */
export function overlaps(a: Pick<Appointment, "starts_at" | "ends_at" | "status">, b: Pick<Appointment, "starts_at" | "ends_at" | "status">): boolean {
  return a.status !== "canceled" && b.status !== "canceled" && a.starts_at < b.ends_at && b.starts_at < a.ends_at;
}
export function findConflicts<T extends Pick<Appointment, "id" | "starts_at" | "ends_at" | "status">>(existing: readonly T[], candidate: Pick<Appointment, "starts_at" | "ends_at" | "status"> & { id?: number | null }): T[] {
  return existing.filter((e) => e.id !== candidate.id && overlaps(e, candidate)).sort((x, y) => x.starts_at - y.starts_at);
}
export const conflictText = (c: readonly Pick<Appointment, "id" | "starts_at" | "ends_at">[]): string =>
  `That time overlaps ${c.length === 1 ? "an existing appointment" : "existing appointments"}: ${c.map((x) => `#${x.id} on ${dayLabel(dateOf(x.starts_at))}, ${rangeLabel(x)}`).join("; ")}.`;

/* ---------------- statuses ---------------- */
const NEXT: Record<Status, Status[]> = { scheduled: ["confirmed", "completed", "canceled"], confirmed: ["scheduled", "completed", "canceled"], completed: [], canceled: ["scheduled"] };
/** Which statuses an appointment may move to. Completed is final; canceled can be reinstated (the overlap check runs again). */
export const allowedNext = (s: Status): Status[] => NEXT[s];
/** An appointment can be marked Completed only once it has started (guards against a stray tap on a future one). */
export const canComplete = (startsAt: number, now: number): boolean => startsAt <= now;
/** Time, length and type can be edited only while the appointment is open. */
export const isEditable = (s: Status): boolean => s === "scheduled" || s === "confirmed";

export function checkTransition(from: Status, to: Status, startsAt: number, now: number): string | null {
  if (from === to) return null;
  if (!NEXT[from].includes(to)) return `A ${STATUS_LABELS[from].toLowerCase()} appointment cannot be changed to ${STATUS_LABELS[to].toLowerCase()}.`;
  if (to === "completed" && !canComplete(startsAt, now)) return "An appointment can be marked completed only after it has started.";
  return null;
}

/* ---------------- forms ---------------- */
export interface AppointmentInput { type: AppointmentType; service_code: string; starts_at: number; ends_at: number; ambiguous: boolean }
export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function parseAppointmentForm(f: Record<string, string | undefined>, services: readonly Pick<Service, "code" | "active">[]): Parsed<AppointmentInput> {
  const errors: string[] = [];
  const type = f.type as AppointmentType;
  if (!APPOINTMENT_TYPES.some((t) => t.id === type)) errors.push("Type: choose Office or Mobile.");
  const service = services.find((s) => s.code === f.service_code);
  if (!service || !service.active) errors.push("Service: choose one from the list.");
  const minutes = /^\d{1,3}$/.test((f.minutes ?? "").trim()) ? Number(f.minutes) : NaN;
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > MAX_MINUTES || minutes % 5 !== 0) errors.push("Length: pick a length in minutes (5 to 720, in steps of 5).");
  const start = fromLocal(f.date ?? "", f.time ?? "");
  if (!start.ok) errors.push(`Start: ${start.error}`);
  if (errors.length || !start.ok) return { ok: false, errors };
  return { ok: true, value: { type, service_code: service!.code, starts_at: start.ms, ends_at: start.ms + minutes * 60000, ambiguous: start.ambiguous } };
}

export function parseCancelReason(raw: string | undefined): CancelReason | null {
  return CANCEL_REASONS.some((r) => r.id === raw) ? (raw as CancelReason) : null;
}

/* ---------------- grouping for the calendar ---------------- */
export function groupByDate<T extends Pick<Appointment, "starts_at">>(list: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const a of [...list].sort((x, y) => x.starts_at - y.starts_at)) { const d = dateOf(a.starts_at); m.set(d, [...(m.get(d) ?? []), a]); }
  return m;
}
/** Open appointments (not canceled) first count for "today" summaries. */
export const openOnly = <T extends Pick<Appointment, "status">>(list: readonly T[]): T[] => list.filter((a) => a.status !== "canceled");
