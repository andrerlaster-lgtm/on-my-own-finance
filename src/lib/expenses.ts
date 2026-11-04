import { parseCents } from "./money";
import { parseDate, type Range } from "./dates";

/*
 * Expenses. Categories are a fixed list for the tax preparer to confirm. Square processing fees are NOT a category: they are already
 * stored on each imported payment, so an expense for them would count them twice. Inventory purchases are not expenses unless entered here.
 * Vendor is a short business name only (no personal details).
 */
export const CATEGORIES = [
  { id: "supplies", label: "Supplies" },
  { id: "insurance", label: "Insurance" },
  { id: "licenses_fees", label: "Licenses and fees" },
  { id: "equipment", label: "Equipment" },
  { id: "software", label: "Software and subscriptions" },
  { id: "advertising", label: "Advertising" },
  { id: "professional_services", label: "Professional services" },
  { id: "phone_internet", label: "Phone and internet" },
  { id: "training", label: "Training and education" },
  { id: "other", label: "Other" },
] as const;
export type Category = (typeof CATEGORIES)[number]["id"];
export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

export interface Expense { id: number; spent_on: string; amount_cents: number; category: Category; vendor: string | null; receipt_on_file: boolean; photos: number }
export interface ExpenseInput { spent_on: string; amount_cents: number; category: Category; vendor: string | null; receipt_on_file: boolean }

/** A business name: letters, digits, spaces and . , & ' - # / only; no long digit runs (card numbers) and no @. */
export function cleanVendor(raw: string | undefined): string | null | "bad" {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  if (v === "") return null;
  if (v.length > 60 || !/^[A-Za-z0-9 .,&'#/-]+$/.test(v) || /\d{6,}/.test(v.replace(/[ -]/g, ""))) return "bad";
  return v;
}

export function parseExpenseForm(f: Record<string, string | undefined>): { ok: true; value: ExpenseInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const spent_on = parseDate(f.spent_on);
  if (!spent_on) errors.push("Date: use a real date.");
  const amount = parseCents(f.amount);
  if (amount === null || amount === 0) errors.push("Amount: dollars greater than zero, like 24.99.");
  const category = f.category as Category;
  if (!CATEGORIES.some((c) => c.id === category)) errors.push("Category: choose one.");
  const vendor = cleanVendor(f.vendor);
  if (vendor === "bad") errors.push("Vendor: a short business name (letters, numbers, spaces and . , & ' - # /). No personal details or long numbers.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { spent_on: spent_on!, amount_cents: amount!, category, vendor: vendor as string | null, receipt_on_file: f.receipt_on_file === "on" } };
}

export function summarizeExpenses(list: readonly Expense[], range: Range): { total: number; count: number } {
  let total = 0, count = 0;
  for (const e of list) if (e.spent_on >= range.from && e.spent_on <= range.to) { total += e.amount_cents; count++; }
  return { total, count };
}

/**
 * Estimated profit = net after processing fees - expenses. Only offered once the period has at least one expense entry, so a period
 * with no expenses entered can never pass for final profit. Before taxes; the mileage deduction is a separate estimate.
 */
export function estimateProfit(netAfterFees: number, expenses: { total: number; count: number }): number | null {
  return expenses.count > 0 ? netAfterFees - expenses.total : null;
}
