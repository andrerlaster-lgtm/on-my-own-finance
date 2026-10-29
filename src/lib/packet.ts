import { toCsv } from "./csv";
import { CATEGORY_LABELS, estimateProfit, summarizeExpenses, type Expense } from "./expenses";
import { SOURCE_LABELS, TAX_FORMS, summarize, type IncomeEntry } from "./income";
import { isBusiness, mileageSummary, PURPOSE_LABELS, type Trip } from "./mileage";
import { needsConfirmation, type TaxYearRules } from "./taxRules";
import { FORM_LABELS, reconcile, setAside, thresholdProgress, type FormEntry, type Payer, type Payment, type ReconRow, type SetAside, type Unformed } from "./taxforms";
import type { Report } from "./lots";

/*
 * The year-end packet for the tax preparer. Pure: it only arranges figures the app already holds. Each section carries its caveats.
 * Not tax advice: no tax, self-employment tax or deduction is decided here.
 */
export interface PacketInput {
  year: number; income: IncomeEntry[]; expenses: Expense[]; trips: Trip[]; rules: TaxYearRules; forms: FormEntry[]; payers: Payer[]; payments: Payment[];
  inventory: Report; expiredLots: number; lastImportRefunds: number;
}
export interface Group { key: string; label: string; count: number; revenue: number; tips: number; receipts: number; fees: number; visits: number }
export interface Readiness { level: "attention" | "note"; text: string }
export interface Packet {
  year: number;
  receipts: { total: Group; bySource: Group[]; byForm: Group[]; byPayer: Group[] };
  expenses: { total: number; count: number; byCategory: { key: string; label: string; total: number; count: number; withReceipt: number; without: number }[] };
  mileage: { miles_tenths: number; trips: number; centsPerMile: number | null; confirmed: boolean; centsPerMileH2?: number | null; confirmedH2?: boolean; deductionCents: number | null };
  inventory: { beginValue: number; purchasesValue: number; usedValue: number; writeOffValue: number; adjustmentsNet: number; endValue: number; problems: string[] };
  profit: { netAfterFees: number; expensesTotal: number; expenseCount: number; estimatedProfit: number | null };
  forms: { rows: ReconRow[]; unformed: Unformed[]; thresholdK: ReturnType<typeof thresholdProgress> & { receipts: number }; thresholdNec: ReturnType<typeof thresholdProgress> & { receipts: number } };
  setAside: SetAside;
  payments: Payment[];
  rules: TaxYearRules & { pending: string[] };
  readiness: Readiness[];
  caveats: string[];
  detail: {
    income: { date: string; source: string; tax_form: string; payer: string; revenue_cents: number; tips_cents: number; fee_cents: number; visits: number }[];
    expenses: { date: string; category: string; vendor: string; amount_cents: number; receipt_kept: string; photos: number }[];
    trips: { date: string; purpose: string; miles: string; odometer_start: string; odometer_end: string }[];
  };
}

export const CAVEATS = [
  "Estimates only. This app organises records; your tax preparer decides what is reported and how.",
  "Revenue excludes tips and excludes refunds. Flagged Square refund rows are left out of income, so receipts can be higher than Square's net.",
  "Tips are shown separately; how they are treated is for the preparer.",
  "Estimated profit is before taxes and before the mileage deduction.",
  "Inventory purchases and expired write-offs are not recorded as expenses; they are in the inventory figures for the preparer to decide.",
  "No income tax, self-employment tax or sales tax is calculated here.",
];

export const PACKET_SECTIONS = ["summary", "receipts", "expenses_by_category", "expenses_detail", "income_detail", "mileage_detail", "form_reconciliation", "tax_payments"] as const;
export type PacketSection = (typeof PACKET_SECTIONS)[number];

function groupBy(entries: readonly IncomeEntry[], keyOf: (e: IncomeEntry) => [string, string]): Group[] {
  const m = new Map<string, Group>();
  for (const e of entries) {
    const [key, label] = keyOf(e);
    const g = m.get(key) ?? { key, label, count: 0, revenue: 0, tips: 0, receipts: 0, fees: 0, visits: 0 };
    g.count++; g.revenue += e.gross_cents; g.tips += e.tip_cents; g.receipts += e.gross_cents + e.tip_cents; g.fees += e.fee_cents; g.visits += e.visits;
    m.set(key, g);
  }
  return [...m.values()].sort((a, b) => b.receipts - a.receipts || a.label.localeCompare(b.label));
}

export function buildPacket(i: PacketInput): Packet {
  const y = `${i.year}-`, range = { from: `${i.year}-01-01`, to: `${i.year}-12-31` };
  const income = i.income.filter((e) => e.occurred_on.startsWith(y)), expenses = i.expenses.filter((e) => e.spent_on.startsWith(y));
  const trips = i.trips.filter((t) => t.driven_on.startsWith(y) && isBusiness(t)), payments = i.payments.filter((p) => p.tax_year === i.year);
  const payerLabel = (id: number | null) => (id === null ? "No payer chosen" : i.payers.find((p) => p.id === id)?.label ?? `Payer ${id}`);
  const formLabel = (id: string) => TAX_FORMS.find((t) => t.id === id)?.label.split(" (")[0] ?? id;

  const sum = summarize(income, range);
  const total: Group = { key: "total", label: "Total", count: income.length, revenue: sum.revenue, tips: sum.tips, receipts: sum.receipts, fees: sum.fees, visits: sum.visits };
  const bySource = groupBy(income, (e) => [e.source, SOURCE_LABELS[e.source] ?? e.source]);
  const byForm = groupBy(income, (e) => [e.tax_form, formLabel(e.tax_form)]);
  const byPayer = groupBy(income, (e) => [String(e.payer_id ?? "none"), payerLabel(e.payer_id)]);

  const ex = summarizeExpenses(expenses, range);
  const catMap = new Map<string, { key: string; label: string; total: number; count: number; withReceipt: number; without: number }>();
  for (const e of expenses) {
    const c = catMap.get(e.category) ?? { key: e.category, label: CATEGORY_LABELS[e.category] ?? e.category, total: 0, count: 0, withReceipt: 0, without: 0 };
    c.total += e.amount_cents; c.count++; (e.receipt_on_file || e.photos > 0 ? c.withReceipt++ : c.without++); catMap.set(e.category, c);
  }

  const rate = { centsPerMile: i.rules.mileage_rate_cents, confirmed: i.rules.mileage_rate_confirmed, h2CentsPerMile: i.rules.mileage_rate_h2_cents, h2Confirmed: i.rules.mileage_rate_h2_confirmed };
  const mi = mileageSummary(trips, range, { [i.year]: rate });
  const mileage = { miles_tenths: mi.miles_tenths, trips: mi.trips, centsPerMile: rate.centsPerMile, confirmed: rate.confirmed, centsPerMileH2: rate.h2CentsPerMile, confirmedH2: rate.h2Confirmed, deductionCents: rate.centsPerMile === null ? null : mi.deductionCents };

  const t = i.inventory.totals;
  const inventory = { beginValue: t.beginValue, purchasesValue: t.purchaseValue + t.openingValue, usedValue: t.useValue, writeOffValue: t.writeOffValue, adjustmentsNet: t.adjUpValue - t.adjDownValue, endValue: t.endValue, problems: i.inventory.problems };

  const estimatedProfit = estimateProfit(sum.netAfterFees, ex);
  const profit = { netAfterFees: sum.netAfterFees, expensesTotal: ex.total, expenseCount: ex.count, estimatedProfit };

  const rec = reconcile(income, i.forms, i.payers, i.year);
  const kReceipts = sum.byTaxForm["1099k"].receipts, nReceipts = sum.byTaxForm["1099nec"].receipts;
  const forms = {
    ...rec,
    thresholdK: { ...thresholdProgress(kReceipts, i.rules.threshold_1099k_dollars, i.rules.threshold_1099k_confirmed), receipts: kReceipts },
    thresholdNec: { ...thresholdProgress(nReceipts, i.rules.threshold_1099nec_dollars, i.rules.threshold_1099nec_confirmed), receipts: nReceipts },
  };

  const paid = payments.reduce((s, p) => s + p.amount_cents, 0);
  const aside = setAside(estimatedProfit, i.rules, paid);
  const pending = needsConfirmation(i.rules);

  const readiness: Readiness[] = [];
  const attn = (text: string) => readiness.push({ level: "attention", text }), note = (text: string) => readiness.push({ level: "note", text });
  for (const p of pending) attn(`Tax rule: ${p}`);
  const undecided = income.filter((e) => e.tax_form === "unknown").length;
  if (undecided) attn(`${undecided} income ${undecided === 1 ? "entry has" : "entries have"} no tax form chosen (1099-K, 1099-NEC or none).`);
  const noReceipt = expenses.filter((e) => !e.receipt_on_file && e.photos === 0).length;
  if (noReceipt) attn(`${noReceipt} expense${noReceipt === 1 ? " has" : "s have"} no receipt kept or photo.`);
  if (i.expiredLots) attn(`${i.expiredLots} inventory lot${i.expiredLots === 1 ? " is" : "s are"} expired with stock still on hand.`);
  if (i.lastImportRefunds) attn(`The latest Square import flagged ${i.lastImportRefunds} refund row${i.lastImportRefunds === 1 ? "" : "s"} that are not counted in income.`);
  if (trips.length && rate.centsPerMile === null) attn("Mileage trips are logged but no mileage rate is set for this year.");
  for (const r of rec.rows) if (r.status !== "match") attn(`${FORM_LABELS[r.form_type]}${r.payer_label ? ` from ${r.payer_label}` : ""}: form shows ${(r.formCents / 100).toFixed(2)} but the app has ${(r.appCents / 100).toFixed(2)}.`);
  for (const u of rec.unformed) attn(`${FORM_LABELS[u.form_type]}${u.payer_label ? ` from ${u.payer_label}` : ""}: the app has receipts but no form amount is entered.`);
  if (i.rules.sales_tax === "applicable") attn("Sales tax is marked as applying, but this app does not track or calculate sales tax.");
  if (inventory.problems.length) attn("The inventory history has a problem that needs fixing before the inventory figures can be trusted.");
  if (income.length === 0) note("No income is recorded for this year.");
  if (ex.count === 0) note("No expenses are entered, so profit is not estimated.");
  if (aside.status === "ok" && aside.remainingCents !== null && aside.remainingCents > 0) note("Set aside so far is less than the estimate; compare with the payments made.");
  note("How tips, expired write-offs and year-end inventory are treated is for your tax preparer.");

  return {
    year: i.year, receipts: { total, bySource, byForm, byPayer },
    expenses: { total: ex.total, count: ex.count, byCategory: [...catMap.values()].sort((a, b) => b.total - a.total) },
    mileage, inventory, profit, forms, setAside: aside, payments,
    rules: { ...i.rules, pending }, readiness, caveats: CAVEATS,
    detail: {
      income: [...income].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on)).map((e) => ({ date: e.occurred_on, source: SOURCE_LABELS[e.source] ?? e.source, tax_form: formLabel(e.tax_form), payer: e.payer_id === null ? "" : payerLabel(e.payer_id), revenue_cents: e.gross_cents, tips_cents: e.tip_cents, fee_cents: e.fee_cents, visits: e.visits })),
      expenses: [...expenses].sort((a, b) => a.spent_on.localeCompare(b.spent_on)).map((e) => ({ date: e.spent_on, category: CATEGORY_LABELS[e.category] ?? e.category, vendor: e.vendor ?? "", amount_cents: e.amount_cents, receipt_kept: e.receipt_on_file ? "yes" : "no", photos: e.photos })),
      trips: [...trips].sort((a, b) => a.driven_on.localeCompare(b.driven_on)).map((t2) => ({ date: t2.driven_on, purpose: PURPOSE_LABELS[t2.purpose] ?? t2.purpose, miles: (t2.miles_tenths / 10).toFixed(1), odometer_start: t2.odometer_start === null ? "" : String(t2.odometer_start), odometer_end: t2.odometer_end === null ? "" : String(t2.odometer_end) })),
    },
  };
}

type Cell = string | number | null;
/** One CSV per section (cents as whole numbers, formula-injection guard applied by toCsv). */
export function packetCsv(p: Packet, section: PacketSection): string {
  const csv = (cols: string[], rows: Record<string, Cell>[]) => toCsv(cols, rows);
  switch (section) {
    case "summary": {
      const r: [string, Cell][] = [
        ["tax_year", p.year], ["revenue_cents (excludes tips and refunds)", p.receipts.total.revenue], ["tips_cents", p.receipts.total.tips], ["total_receipts_cents", p.receipts.total.receipts],
        ["processing_fees_cents", p.receipts.total.fees], ["net_after_processing_fees_cents", p.profit.netAfterFees], ["expenses_cents", p.profit.expensesTotal],
        ["estimated_profit_cents (before taxes and mileage deduction)", p.profit.estimatedProfit], ["miles", (p.mileage.miles_tenths / 10).toFixed(1)], ["mileage_rate_cents_per_mile", p.mileage.centsPerMile],
        ["mileage_rate_confirmed", p.mileage.confirmed ? "yes" : "no"], ["mileage_rate_from_july_1_cents_per_mile", p.mileage.centsPerMileH2 ?? null], ["mileage_rate_from_july_1_confirmed", p.mileage.confirmedH2 ? "yes" : "no"], ["mileage_deduction_estimate_cents", p.mileage.deductionCents],
        ["inventory_value_start_cents", p.inventory.beginValue], ["inventory_purchases_cents", p.inventory.purchasesValue], ["inventory_used_cents", p.inventory.usedValue],
        ["inventory_expired_writeoffs_cents", p.inventory.writeOffValue], ["inventory_value_end_cents", p.inventory.endValue],
        ["set_aside_percent", p.rules.set_aside_percent], ["set_aside_confirmed", p.rules.set_aside_confirmed ? "yes" : "no"], ["set_aside_estimate_cents", p.setAside.amountCents],
        ["tax_payments_recorded_cents", p.setAside.paidCents], ["sales_tax_status", p.rules.sales_tax], ["sales_tax_confirmed", p.rules.sales_tax_confirmed ? "yes" : "no"],
      ];
      return csv(["item", "value"], r.map(([item, value]) => ({ item, value })));
    }
    case "receipts": {
      const rows: Record<string, Cell>[] = [];
      for (const [dim, gs] of [["source", p.receipts.bySource], ["tax_form", p.receipts.byForm], ["payer", p.receipts.byPayer]] as const)
        for (const g of gs) rows.push({ grouped_by: dim, name: g.label, entries: g.count, revenue_cents: g.revenue, tips_cents: g.tips, receipts_cents: g.receipts, fees_cents: g.fees, visits: g.visits });
      rows.push({ grouped_by: "all", name: "Total", entries: p.receipts.total.count, revenue_cents: p.receipts.total.revenue, tips_cents: p.receipts.total.tips, receipts_cents: p.receipts.total.receipts, fees_cents: p.receipts.total.fees, visits: p.receipts.total.visits });
      return csv(["grouped_by", "name", "entries", "revenue_cents", "tips_cents", "receipts_cents", "fees_cents", "visits"], rows);
    }
    case "expenses_by_category":
      return csv(["category", "entries", "total_cents", "with_receipt", "without_receipt"], p.expenses.byCategory.map((c) => ({ category: c.label, entries: c.count, total_cents: c.total, with_receipt: c.withReceipt, without_receipt: c.without })));
    case "expenses_detail": return csv(["date", "category", "vendor", "amount_cents", "receipt_kept", "photos"], p.detail.expenses);
    case "income_detail": return csv(["date", "source", "tax_form", "payer", "revenue_cents", "tips_cents", "fee_cents", "visits"], p.detail.income);
    case "mileage_detail": return csv(["date", "purpose", "miles", "odometer_start", "odometer_end"], p.detail.trips);
    case "form_reconciliation":
      return csv(["form", "payer", "form_amount_cents", "app_receipts_cents", "difference_cents", "status"], [
        ...p.forms.rows.map((r) => ({ form: FORM_LABELS[r.form_type], payer: r.payer_label ?? "", form_amount_cents: r.formCents, app_receipts_cents: r.appCents, difference_cents: r.diff, status: r.status })),
        ...p.forms.unformed.map((u) => ({ form: FORM_LABELS[u.form_type], payer: u.payer_label ?? "", form_amount_cents: null, app_receipts_cents: u.appCents, difference_cents: null, status: "no_form_entered" })),
      ]);
    case "tax_payments": return csv(["date_paid", "type", "amount_cents"], p.payments.map((x) => ({ date_paid: x.paid_on, type: x.kind === "federal_estimated" ? "Federal estimated" : "Other", amount_cents: x.amount_cents })));
  }
}
