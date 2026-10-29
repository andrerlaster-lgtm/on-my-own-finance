/*
 * Tax-year rules: the numbers that change from year to year and that the tax preparer must confirm. None is assumed:
 * a value starts empty ("not set"), and each one has its own "confirmed with preparer" flag. Nothing here is tax advice;
 * the app organises records and estimates, and the preparer decides. Pure: no network, no database.
 */
export const RULE_FIELDS = [
  { key: "mileage_rate_cents", confirmKey: "mileage_rate_confirmed", label: "Mileage rate (cents per mile)", hint: "The business mileage rate for this tax year.", min: 0, max: 500, step: "0.1" },
  { key: "mileage_rate_h2_cents", confirmKey: "mileage_rate_h2_confirmed", label: "Mileage rate from July 1 (cents per mile)", hint: "Only if the IRS changed the rate partway through the year (it did in 2026). Trips dated July 1 or later use this rate; earlier trips use the rate above. Leave empty if one rate covers the year.", min: 0, max: 500, step: "0.1", optional: true },
  { key: "set_aside_percent", confirmKey: "set_aside_confirmed", label: "Tax set-aside (% of profit)", hint: "How much of each period's profit to put aside for taxes. Your preparer gives you this.", min: 0, max: 70, step: "0.1" },
  { key: "threshold_1099k_dollars", confirmKey: "threshold_1099k_confirmed", label: "1099-K reporting threshold ($)", hint: "Processors such as Square report to the IRS above this amount for the year. For 2026 the processor threshold is $20,000 and more than 200 transactions, but some card payments have no minimum, so confirm with your preparer.", min: 0, max: 10000000, step: "1" },
  { key: "threshold_1099nec_dollars", confirmKey: "threshold_1099nec_confirmed", label: "1099-NEC reporting threshold ($)", hint: "A business that paid you (such as a lab) sends a 1099-NEC when it pays you this amount or more for the year. Income below the threshold is still taxable.", min: 0, max: 10000000, step: "1" },
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
  mileage_rate_h2_cents: number | null;
  set_aside_percent: number | null;
  threshold_1099k_dollars: number | null;
  threshold_1099nec_dollars: number | null;
  sales_tax: SalesTax;
  mileage_rate_confirmed: boolean;
  mileage_rate_h2_confirmed: boolean;
  set_aside_confirmed: boolean;
  threshold_1099k_confirmed: boolean;
  threshold_1099nec_confirmed: boolean;
  sales_tax_confirmed: boolean;
}

export const emptyRules = (tax_year: number): TaxYearRules => ({
  tax_year, mileage_rate_cents: null, mileage_rate_h2_cents: null, set_aside_percent: null, threshold_1099k_dollars: null, threshold_1099nec_dollars: null, sales_tax: "unknown",
  mileage_rate_confirmed: false, mileage_rate_h2_confirmed: false, set_aside_confirmed: false, threshold_1099k_confirmed: false, threshold_1099nec_confirmed: false, sales_tax_confirmed: false,
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
    if (value === null) { if (!("optional" in f && f.optional)) out.push(`${f.label}: not set`); }
    else if (!confirmed) out.push(`${f.label}: set but not confirmed with the preparer`);
  }
  if (r.sales_tax === "unknown") out.push("Sales tax: not decided");
  else if (!r.sales_tax_confirmed) out.push("Sales tax: not confirmed with the preparer");
  return out;
}

/*
 * Figures the IRS or Congress published, so you don't have to look them up. They are offered, never assumed: "Fill in the published
 * figures" copies them into EMPTY fields only, leaves every "confirmed with preparer" box unchecked, and never overwrites a value you set.
 * The set-aside percent is not published anywhere (your preparer sets it), so it is never filled in.
 */
export type RuleKey = (typeof RULE_FIELDS)[number]["key"];
export interface PublishedFigure { value: number; note: string; source: string }

export const PUBLISHED_RULES: Record<number, Partial<Record<RuleKey, PublishedFigure>>> = {
  2026: {
    mileage_rate_cents: { value: 72.5, note: "Business rate for miles driven January 1 to June 30, 2026.", source: "IRS Notice 2026-10 (announced December 2025)" },
    mileage_rate_h2_cents: { value: 76, note: "Business rate for miles driven July 1 to December 31, 2026. The IRS raised it mid-year; the rate depends on the date of the trip.", source: "IRS Announcement 2026-11" },
    threshold_1099k_dollars: { value: 20000, note: "Processors report above $20,000 and more than 200 transactions. The 2025 tax law (One Big Beautiful Bill Act) restored this; the lower $2,500 and $600 thresholds that were scheduled did not take effect. Some card payments have no minimum.", source: "One Big Beautiful Bill Act, reinstating the pre-2022 threshold" },
    threshold_1099nec_dollars: { value: 2000, note: "For payments made after December 31, 2025 (raised from $600). Adjusted for inflation starting in 2027.", source: "One Big Beautiful Bill Act, section 70433" },
  },
};

export const publishedFor = (year: number) => PUBLISHED_RULES[year] ?? null;

/** Copies published figures into fields that are still empty. Confirmations are never set. Returns the rules and what was filled. */
export function applyPublished(rules: TaxYearRules): { rules: TaxYearRules; filled: string[] } {
  const pub = publishedFor(rules.tax_year);
  const next = { ...rules };
  const filled: string[] = [];
  if (!pub) return { rules: next, filled };
  for (const f of RULE_FIELDS) {
    const figure = pub[f.key];
    if (figure && (next as unknown as Record<string, unknown>)[f.key] === null) {
      (next as unknown as Record<string, unknown>)[f.key] = figure.value;
      filled.push(f.label);
    }
  }
  return { rules: next, filled };
}
