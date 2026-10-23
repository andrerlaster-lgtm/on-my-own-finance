/** Calendar dates as "YYYY-MM-DD" text, so no time zone can shift a day. "Today" is in Central time (the business is in Texas). */
export function parseDate(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d || y < 2000 || y > 2100) return null;
  return s;
}

export function todayInChicago(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const toUtc = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (s: string, n: number): string => fromUtc(toUtc(s) + n * 86_400_000);

export interface Range { from: string; to: string } // inclusive
export interface Periods { week: Range; month: Range; year: Range }

/** Week = Monday to Sunday. */
export function periodRanges(today: string): Periods {
  const dow = (new Date(toUtc(today)).getUTCDay() + 6) % 7; // Monday = 0
  const weekFrom = addDays(today, -dow);
  const [y, m] = today.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    week: { from: weekFrom, to: addDays(weekFrom, 6) },
    month: { from: `${y}-${String(m).padStart(2, "0")}-01`, to: `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` },
    year: { from: `${y}-01-01`, to: `${y}-12-31` },
  };
}
