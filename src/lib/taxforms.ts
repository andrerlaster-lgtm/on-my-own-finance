import { parseCents } from "./money";
import { parseDate } from "./dates";
import { cleanVendor } from "./expenses";
import { parseYear, type TaxYearRules } from "./taxRules";
import type { IncomeEntry } from "./income";

/*
 * 1099 forms, payers and estimated tax payments. Not tax advice and no tax is calculated here: this only lines the app's records up
 * against the forms you receive, and tracks what you set aside and paid. Payers are business labels only (no EIN, SSN or contact details).
 */
export const FORM_TYPES = [{ id: "1099k", label: "1099-K" }, { id: "1099nec", label: "1099-NEC" }] as const;
export type FormType = (typeof FORM_TYPES)[number]["id"];
export const FORM_LABELS: Record<string, string> = { "1099k": "1099-K", "1099nec": "1099-NEC" };

export interface Payer { id: number; label: string }
export interface FormEntry { id: number; tax_year: number; form_type: FormType; payer_id: number | null; amount_cents: number }
export type PaymentKind = "federal_estimated" | "other";
export const PAYMENT_KINDS: { id: PaymentKind; label: string }[] = [{ id: "federal_estimated", label: "Federal estimated tax" }, { id: "other", label: "Other tax payment" }];
export interface Payment { id: number; tax_year: number; paid_on: string; amount_cents: number; kind: PaymentKind }

type Form = Record<string, string | undefined>;
type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function parsePayerForm(f: Form): Parsed<{ label: string }> {
  const v = cleanVendor(f.label);
  if (v === null || v === "bad") return { ok: false, errors: ["Payer: a short business name (letters, numbers, spaces and . , & ' - # /). No personal details, tax IDs or long numbers."] };
  return { ok: true, value: { label: v } };
}

export function parseFormEntry(f: Form): Parsed<{ tax_year: number; form_type: FormType; payer_id: number | null; amount_cents: number }> {
  const errors: string[] = [];
  const tax_year = parseYear(f.tax_year);
  if (tax_year === null) errors.push("Tax year: 2000 to 2100.");
  const form_type = f.form_type as FormType;
  if (!FORM_TYPES.some((t) => t.id === form_type)) errors.push("Form: choose 1099-K or 1099-NEC.");
  const pr = (f.payer_id ?? "").trim();
  const payer_id = pr === "" ? null : /^\d{1,12}$/.test(pr) ? Number(pr) : undefined;
  if (payer_id === undefined) errors.push("Payer: choose from the list.");
  if (form_type === "1099nec" && payer_id === null) errors.push("A 1099-NEC needs the payer who sent it.");
  const amount = parseCents(f.amount);
  if (amount === null) errors.push("Amount: dollars like 12500.00 (the figure printed on the form).");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { tax_year: tax_year!, form_type, payer_id: payer_id as number | null, amount_cents: amount! } };
}

export function parsePaymentForm(f: Form): Parsed<{ tax_year: number; paid_on: string; amount_cents: number; kind: PaymentKind }> {
  const errors: string[] = [];
  const tax_year = parseYear(f.tax_year), paid_on = parseDate(f.paid_on), amount = parseCents(f.amount), kind = f.kind as PaymentKind;
  if (tax_year === null) errors.push("Tax year the payment is for: 2000 to 2100.");
  if (!paid_on) errors.push("Date paid: use a real date.");
  if (amount === null || amount === 0) errors.push("Amount: dollars greater than zero.");
  if (!PAYMENT_KINDS.some((k) => k.id === kind)) errors.push("Type: choose one.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { tax_year: tax_year!, paid_on: paid_on!, amount_cents: amount!, kind } };
}

export interface ReconRow { form_type: FormType; payer_label: string | null; formCents: number; appCents: number; diff: number; status: "match" | "form_higher" | "app_higher" }
export interface Unformed { form_type: FormType; payer_label: string | null; appCents: number }

/**
 * Form amounts vs the app's receipts (revenue + tips, before fees) for entries marked with that form and payer. A 1099-K normally reports gross
 * payments including tips and before fees; the app leaves flagged Square refunds out. Differences are shown, never "fixed".
 */
export function reconcile(entries: readonly IncomeEntry[], forms: readonly FormEntry[], payers: readonly Payer[], year: number): { rows: ReconRow[]; unformed: Unformed[] } {
  const label = (id: number | null) => (id === null ? null : payers.find((p) => p.id === id)?.label ?? `Payer ${id}`);
  const key = (t: string, p: number | null) => `${t}|${p ?? ""}`;
  const app = new Map<string, number>();
  for (const e of entries) {
    if (!e.occurred_on.startsWith(`${year}-`) || (e.tax_form !== "1099k" && e.tax_form !== "1099nec")) continue;
    app.set(key(e.tax_form, e.payer_id), (app.get(key(e.tax_form, e.payer_id)) ?? 0) + e.gross_cents + e.tip_cents);
  }
  const formSum = new Map<string, { type: FormType; payer: number | null; cents: number }>();
  for (const f of forms) {
    if (f.tax_year !== year) continue;
    const k = key(f.form_type, f.payer_id), cur = formSum.get(k) ?? { type: f.form_type, payer: f.payer_id, cents: 0 };
    cur.cents += f.amount_cents; formSum.set(k, cur);
  }
  const rows: ReconRow[] = [...formSum.entries()].map(([k, f]) => {
    const appCents = app.get(k) ?? 0, diff = f.cents - appCents;
    return { form_type: f.type, payer_label: label(f.payer), formCents: f.cents, appCents, diff, status: diff === 0 ? "match" : diff > 0 ? "form_higher" : "app_higher" };
  });
  const unformed: Unformed[] = [...app.entries()].filter(([k]) => !formSum.has(k)).map(([k, appCents]) => {
    const [t, p] = k.split("|"); return { form_type: t as FormType, payer_label: label(p === "" ? null : Number(p)), appCents };
  });
  return { rows, unformed };
}

export type ThresholdStatus = "unset" | "unconfirmed" | "below" | "reached";
/** Progress toward a 1099 reporting threshold. Only meaningful once the threshold is set and confirmed with the preparer. */
export function thresholdProgress(totalCents: number, thresholdDollars: number | null, confirmed: boolean): { status: ThresholdStatus; thresholdCents: number | null } {
  if (thresholdDollars === null) return { status: "unset", thresholdCents: null };
  const thresholdCents = thresholdDollars * 100;
  if (!confirmed) return { status: "unconfirmed", thresholdCents };
  return { status: totalCents >= thresholdCents ? "reached" : "below", thresholdCents };
}

export interface SetAside { status: "ok" | "no_profit_estimate" | "percent_not_set" | "percent_not_confirmed"; amountCents: number | null; paidCents: number; remainingCents: number | null }
/** set-aside = percent x estimated profit (before the mileage deduction, so it errs on the high side). Shown only when the percent is confirmed. */
export function setAside(profitCents: number | null, rules: Pick<TaxYearRules, "set_aside_percent" | "set_aside_confirmed">, paidCents: number): SetAside {
  const base = { amountCents: null, paidCents, remainingCents: null };
  if (rules.set_aside_percent === null) return { status: "percent_not_set", ...base };
  if (!rules.set_aside_confirmed) return { status: "percent_not_confirmed", ...base };
  if (profitCents === null) return { status: "no_profit_estimate", ...base };
  const amountCents = Math.round((Math.max(0, profitCents) * rules.set_aside_percent) / 100);
  return { status: "ok", amountCents, paidCents, remainingCents: amountCents - paidCents };
}
