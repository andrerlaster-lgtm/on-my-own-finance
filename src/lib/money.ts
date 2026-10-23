/** Money is whole cents everywhere. Pure: no network, no database. */
const MAX_CENTS = 99_999_999_999;

/** "12", "12.5", "12.50" -> cents. Anything else (empty, negative, 3 decimals, letters, commas) -> null. */
export function parseCents(raw: string | undefined): number | null {
  const s = (raw ?? "").trim().replace(/^\$/, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [d, c = ""] = s.split(".");
  const cents = Number(d) * 100 + Number(c.padEnd(2, "0"));
  return cents <= MAX_CENTS ? cents : null;
}

export function formatCents(cents: number): string {
  const neg = cents < 0, abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** For a form field's default value. */
export const centsToInput = (cents: number): string => (cents / 100).toFixed(2);
