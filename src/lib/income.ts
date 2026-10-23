import { parseCents } from "./money";
import { parseDate, type Range } from "./dates";

/*
 * Income. Where the money came from (source) and how it is reported to the IRS (tax_form) are two independent choices;
 * one never fills in the other. Amounts, in whole cents:
 *   gross = service revenue only      tip = tips only (never included in gross)      fee = processing fee on the whole charge
 *   total receipts = gross + tip      net after fees (before expenses) = total receipts - fee
 * Refunds are not income entries: Square refund rows are flagged at import and left out, so revenue totals EXCLUDE refunds.
 * Nothing here is tax advice; how tips are treated is for the tax preparer.
 */
export const MANUAL_SOURCES = [
  { id: "bank_transfer", label: "Bank transfer / direct deposit" },
  { id: "check", label: "Check" },
  { id: "cash", label: "Cash" },
  { id: "other", label: "Other" },
] as const;
export const SOURCE_LABELS: Record<string, string> = { square: "Square", bank_transfer: "Bank transfer", check: "Check", cash: "Cash", other: "Other" };

export const TAX_FORMS = [
  { id: "unknown", label: "Not decided (ask the preparer)" },
  { id: "1099k", label: "1099-K" },
  { id: "1099nec", label: "1099-NEC" },
  { id: "none", label: "No form expected" },
] as const;
export type TaxForm = (typeof TAX_FORMS)[number]["id"];

export interface IncomeEntry {
  id: number; occurred_on: string; source: string; tax_form: TaxForm;
  gross_cents: number; tip_cents: number; fee_cents: number; visits: number; imported: boolean;
}
export interface IncomeInput { occurred_on: string; source: string; tax_form: TaxForm; gross_cents: number; tip_cents: number; fee_cents: number; visits: number }

export function parseIncomeForm(form: Record<string, string | undefined>): { ok: true; value: IncomeInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const occurred_on = parseDate(form.occurred_on);
  if (!occurred_on) errors.push("Date: use a real date.");
  const source = form.source ?? "";
  if (!MANUAL_SOURCES.some((s) => s.id === source)) errors.push("Source: choose one (Square entries come from the Square import).");
  const tax_form = (form.tax_form ?? "unknown") as TaxForm;
  if (!TAX_FORMS.some((t) => t.id === tax_form)) errors.push("Tax form: choose one of the options.");
  const gross = (form.gross ?? "").trim() === "" ? 0 : parseCents(form.gross);
  const tip = (form.tip ?? "").trim() === "" ? 0 : parseCents(form.tip);
  const fee = (form.fee ?? "").trim() === "" ? 0 : parseCents(form.fee);
  if (gross === null) errors.push("Revenue: enter dollars like 150 or 150.00.");
  if (tip === null) errors.push("Tips: enter dollars like 20 or 20.00, or leave empty.");
  if (fee === null) errors.push("Processing fee: enter dollars like 4.35, or leave empty.");
  const visits = parseVisits(form.visits);
  if (visits === null) errors.push("Visits: a whole number from 0 to 1000.");
  if (!errors.length && (gross as number) + (tip as number) === 0) errors.push("Enter revenue or tips greater than zero.");
  if (!errors.length && (fee as number) > (gross as number) + (tip as number)) errors.push("Processing fee can't be more than revenue plus tips.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { occurred_on: occurred_on!, source, tax_form, gross_cents: gross!, tip_cents: tip!, fee_cents: fee!, visits: visits! } };
}

/** Visits are optional: empty means 0 ("not entered"). */
export function parseVisits(raw: string | undefined): number | null {
  const s = (raw ?? "").trim();
  if (s === "") return 0;
  return /^\d{1,4}$/.test(s) && Number(s) <= 1000 ? Number(s) : null;
}

export interface Totals { visits: number; revenue: number; tips: number; receipts: number; fees: number; netAfterFees: number }
export interface Summary extends Totals { byTaxForm: Record<TaxForm, { receipts: number; fees: number }> }

const emptyTotals = (): Totals => ({ visits: 0, revenue: 0, tips: 0, receipts: 0, fees: 0, netAfterFees: 0 });

/** Totals for entries dated inside the range (inclusive). Each cent is counted once: revenue and tips are separate fields. */
export function summarize(entries: readonly IncomeEntry[], range: Range): Summary {
  const t = emptyTotals();
  const byTaxForm = Object.fromEntries(TAX_FORMS.map((f) => [f.id, { receipts: 0, fees: 0 }])) as Summary["byTaxForm"];
  for (const e of entries) {
    if (e.occurred_on < range.from || e.occurred_on > range.to) continue;
    t.visits += e.visits; t.revenue += e.gross_cents; t.tips += e.tip_cents; t.fees += e.fee_cents;
    const b = byTaxForm[e.tax_form] ?? byTaxForm.unknown;
    b.receipts += e.gross_cents + e.tip_cents; b.fees += e.fee_cents;
  }
  t.receipts = t.revenue + t.tips;
  t.netAfterFees = t.receipts - t.fees;
  return { ...t, byTaxForm };
}
