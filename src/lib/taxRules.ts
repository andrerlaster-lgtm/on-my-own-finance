/*
 * Tax-year rules: the numbers that change from year to year and that the tax preparer must confirm. None is assumed:
 * a value starts empty ("not set"), and each one has its own "confirmed with preparer" flag. Nothing here is tax advice;
 * the app organises records and estimates, and the preparer decides. Pure: no network, no database.
 */
export const RULE_FIELDS = [
  { key: "mileage_rate_cents", confirmKey: "mileage_rate_confirmed", label: "Mileage rate (cents per mile)", hint: "The business mileage rate for this tax year.", min: 0, max: 500, step: "0.1" },
  { key: "set_aside_percent", confirmKey: "set_aside_confirmed", label: "Tax set-aside (% of profit)", hint: "How much of each period's profit to put aside for taxes. Your preparer gives you this.", min: 0, max: 70, step: "0.1" },
  { key: "threshold_1099k_dollars", confirmKey: "threshold_1099k_confirmed", label: "1099-K reporting threshold ($)", hint: "Payment-card and app processors (such as Square) report to the IRS above this amount for the year.", min: 0, max: 10000000, step: "1" },
  { key: "threshold_1099nec_dollars", confirmKey: "threshold_1099nec_confirmed", label: "1099-NEC reporting threshold ($)", hint: "A business that paid you (such as a lab) sends a 1099-NEC above this amount for the year.", min: 0, max: 10000000, step: "1" },
] as const;

export type SalesTax = "unknown" | "not_applicable" | "applicable";
export const SALES_TAX_OPTIONS: { id: SalesTax; label: string }[] = [
  { id: "unknown", label: "Not decided yet" },
  { id: "not_applicable", label: "Does not apply to her services" },
  { id: "applicable", label: "Applies" },
];

export interface TaxYearRules {
  tax_year: number;
  mileage_rate_cents: number | null;
  set_aside_percent: number | null;
  threshold_1099k_dollars: number | null;
  threshold_1099nec_dollars: number | null;
  sales_tax: SalesTax;
  mileage_rate_confirmed: boolean;
  set_aside_confirmed: boolean;
  threshold_1099k_confirmed: boolean;
  threshold_1099nec_confirmed: boolean;
  sales_tax_confirmed: boolean;
}

export const emptyRules = (tax_year: number): TaxYearRules => ({
  tax_year, mileage_rate_cents: null, set_aside_percent: null, threshold_1099k_dollars: null, threshold_1099nec_dollars: null, sales_tax: "unknown",
  mileage_rate_confirmed: false, set_aside_confirmed: false, threshold_1099k_confirmed: false, threshold_1099nec_confirmed: false, sales_tax_confirmed: false,
});

export const MIN_YEAR = 2000, MAX_YEAR = 2100;
export const parseYear = (raw: unknown): number | null => {
  const n = typeof raw === "string" && /^\d{4}$/.test(raw.trim()) ? Number(raw) : typeof raw === "number" && Number.isInteger(raw) ? raw : NaN;
  return Number.isInteger(n) && n >= MIN_YEAR && n <= MAX_YEAR ? n : null;
};

export type ParseResult = { ok: true; rules: TaxYearRules } | { ok: false; errors: string[] };

/** Reads the settings form (plain strings). Empty = not set. Anything out of range or not a number is an error, never clamped. */
export function parseRulesForm(form: Record<string, string | undefined>): ParseResult {
  const errors: string[] = [];
  const year = parseYear(form.tax_year);
  if (year === null) return { ok: false, errors: [`Choose a tax year from ${MIN_YEAR} to ${MAX_YEAR}.`] };
  const rules = emptyRules(year);
  for (const f of RULE_FIELDS) {
    const raw = (form[f.key] ?? "").trim();
    if (raw !== "") {
      const n = Number(raw);
      if (!/^\d+(\.\d+)?$/.test(raw) || !Number.isFinite(n) || n < f.min || n > f.max) errors.push(`${f.label}: enter a number from ${f.min} to ${f.max}, or leave it empty.`);
      else (rules as unknown as Record<string, unknown>)[f.key] = f.step === "1" ? Math.round(n) : Math.round(n * 100) / 100;
    }
    const confirmed = form[f.confirmKey] === "on";
    if (confirmed && raw === "") errors.push(`${f.label}: enter the number before marking it confirmed.`);
    (rules as unknown as Record<string, unknown>)[f.confirmKey] = confirmed && raw !== "";
  }
  const st = form.sales_tax as SalesTax | undefined;
  if (st !== undefined && !SALES_TAX_OPTIONS.some((o) => o.id === st)) errors.push("Sales tax: choose one of the options.");
  rules.sales_tax = st && SALES_TAX_OPTIONS.some((o) => o.id === st) ? st : "unknown";
  rules.sales_tax_confirmed = form.sales_tax_confirmed === "on" && rules.sales_tax !== "unknown";
  if (form.sales_tax_confirmed === "on" && rules.sales_tax === "unknown") errors.push("Sales tax: choose an answer before marking it confirmed.");
  return errors.length ? { ok: false, errors } : { ok: true, rules };
}

/** What still needs the preparer: a plain list for the home page and the settings page. */
export function needsConfirmation(r: TaxYearRules): string[] {
  const out: string[] = [];
  for (const f of RULE_FIELDS) {
    const value = (r as unknown as Record<string, unknown>)[f.key];
    const confirmed = (r as unknown as Record<string, unknown>)[f.confirmKey];
    if (value === null) out.push(`${f.label}: not set`);
    else if (!confirmed) out.push(`${f.label}: set but not confirmed with the preparer`);
  }
  if (r.sales_tax === "unknown") out.push("Sales tax: not decided");
  else if (!r.sales_tax_confirmed) out.push("Sales tax: not confirmed with the preparer");
  return out;
}
