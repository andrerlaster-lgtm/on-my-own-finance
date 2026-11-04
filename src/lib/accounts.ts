/*
 * Chart of accounts. Standard classifications with conventional numbering. Pure: no network, no database.
 *
 * Accounts are never deleted: a used account is deactivated, which only hides it from pickers while every past transaction keeps
 * pointing at it. Accounts marked "system" are the ones the automatic postings need (cash, Square balance, revenue, and so on);
 * they can be renamed or renumbered, but not deactivated or moved to another type. Text fields hold business wording only.
 */
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "cost_of_services" | "operating_expense" | "other";
export type Side = "debit" | "credit";

export const TYPE_INFO: Record<AccountType, { label: string; plural: string; min: number; max: number; normal: Side | null }> = {
  asset: { label: "Asset", plural: "Assets", min: 1000, max: 1999, normal: "debit" },
  liability: { label: "Liability", plural: "Liabilities", min: 2000, max: 2999, normal: "credit" },
  equity: { label: "Equity", plural: "Equity", min: 3000, max: 3999, normal: "credit" },
  revenue: { label: "Revenue", plural: "Revenue", min: 4000, max: 4999, normal: "credit" },
  cost_of_services: { label: "Cost of services", plural: "Cost of services", min: 5000, max: 5999, normal: "debit" },
  operating_expense: { label: "Operating expense", plural: "Operating expenses", min: 6000, max: 6999, normal: "debit" },
  other: { label: "Other income or expense", plural: "Other income and expenses", min: 7000, max: 7999, normal: null }, // each account says which side
};
export const TYPE_ORDER: AccountType[] = ["asset", "liability", "equity", "revenue", "cost_of_services", "operating_expense", "other"];

export interface Account { id: number; number: number; label: string; type: AccountType; normal: Side; system_key: string | null; active: boolean }

export interface DefaultAccount { number: number; label: string; type: AccountType; normal: Side; key: string | null; note?: string }

/** Seeded once at setup (never overwritten). `key` is how automatic postings find an account even if you rename or renumber it. */
export const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  { number: 1000, label: "Cash and bank accounts", type: "asset", normal: "debit", key: "cash_bank" },
  { number: 1010, label: "Square balance (not yet paid out)", type: "asset", normal: "debit", key: "square_balance" },
  { number: 1200, label: "Accounts receivable", type: "asset", normal: "debit", key: null, note: "Not used yet: reports are cash basis." },
  { number: 1300, label: "Inventory: medical supplies", type: "asset", normal: "debit", key: "inventory" },
  { number: 2000, label: "Accounts payable", type: "liability", normal: "credit", key: null, note: "Not used yet: reports are cash basis." },
  { number: 2100, label: "Sales tax payable", type: "liability", normal: "credit", key: null },
  { number: 3000, label: "Owner contributions", type: "equity", normal: "credit", key: "owner_contributions" },
  { number: 3100, label: "Owner draws", type: "equity", normal: "debit", key: "owner_draws" },
  { number: 3900, label: "Opening balance equity", type: "equity", normal: "credit", key: "opening_equity" },
  { number: 4000, label: "Service revenue", type: "revenue", normal: "credit", key: "service_revenue" },
  { number: 5010, label: "Medical supplies consumed", type: "cost_of_services", normal: "debit", key: "supplies_consumed" },
  { number: 5020, label: "Collection kits", type: "cost_of_services", normal: "debit", key: null },
  { number: 5030, label: "Direct contractor labor", type: "cost_of_services", normal: "debit", key: null },
  { number: 5040, label: "Other direct service costs", type: "cost_of_services", normal: "debit", key: null },
  { number: 5060, label: "Inventory write-offs and adjustments", type: "cost_of_services", normal: "debit", key: "inventory_adjust" },
  { number: 6010, label: "Insurance", type: "operating_expense", normal: "debit", key: "cat:insurance" },
  { number: 6020, label: "Licenses and fees", type: "operating_expense", normal: "debit", key: "cat:licenses_fees" },
  { number: 6030, label: "Equipment and tools", type: "operating_expense", normal: "debit", key: "cat:equipment" },
  { number: 6040, label: "Software and subscriptions", type: "operating_expense", normal: "debit", key: "cat:software" },
  { number: 6050, label: "Advertising", type: "operating_expense", normal: "debit", key: "cat:advertising" },
  { number: 6060, label: "Professional services", type: "operating_expense", normal: "debit", key: "cat:professional_services" },
  { number: 6070, label: "Phone and internet", type: "operating_expense", normal: "debit", key: "cat:phone_internet" },
  { number: 6080, label: "Training and education", type: "operating_expense", normal: "debit", key: "cat:training" },
  { number: 6090, label: "Office and general supplies", type: "operating_expense", normal: "debit", key: "cat:supplies" },
  { number: 6100, label: "Payment processing fees", type: "operating_expense", normal: "debit", key: "processing_fees" },
  { number: 6900, label: "Other operating expenses", type: "operating_expense", normal: "debit", key: "cat:other" },
  { number: 7010, label: "Tips received (treatment to confirm with preparer)", type: "other", normal: "credit", key: "tips" },
  { number: 7020, label: "Interest and other income", type: "other", normal: "credit", key: null },
  { number: 7900, label: "Other expenses", type: "other", normal: "debit", key: null },
];

export const CATEGORY_KEY_PREFIX = "cat:";

/** Business wording only: letters, digits, spaces and . , & ' - # / ( ) : ; no @, no long digit runs (card numbers). */
export function cleanLabel(raw: string | undefined, max = 60): string | null {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  if (v.length < 1 || v.length > max || !/^[A-Za-z0-9 .,&'#/():-]+$/.test(v) || /\d{6,}/.test(v.replace(/[ -]/g, ""))) return null;
  return v;
}

export interface AccountForm { number?: string; label?: string; type?: string; normal?: string }
export interface AccountInput { number: number; label: string; type: AccountType; normal: Side }

/**
 * Checks a new or edited account. `existing` is every account (for unique numbers); `editing` is the account being edited, if any.
 * `hasHistory` = it already has transactions (its type then cannot change, because that would move past results between statements).
 */
export function validateAccountForm(f: AccountForm, existing: readonly Account[], editing?: Account, hasHistory = false): { ok: true; value: AccountInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const type = (f.type ?? editing?.type ?? "") as AccountType;
  if (!(type in TYPE_INFO)) errors.push("Type: choose one.");
  const num = /^\d{4}$/.test((f.number ?? "").trim()) ? Number((f.number ?? "").trim()) : null;
  if (num === null) errors.push("Account number: four digits, like 6150.");
  else if (type in TYPE_INFO && (num < TYPE_INFO[type].min || num > TYPE_INFO[type].max)) errors.push(`Account number: ${TYPE_INFO[type].plural} use ${TYPE_INFO[type].min} to ${TYPE_INFO[type].max}.`);
  if (num !== null && existing.some((a) => a.number === num && a.id !== editing?.id)) errors.push(`Account number ${num} is already used.`);
  const label = cleanLabel(f.label);
  if (!label) errors.push("Name: 1 to 60 characters (letters, numbers, spaces and . , & ' - # / ( ) :). No personal details or long numbers.");
  else if (existing.some((a) => a.label.toLowerCase() === label.toLowerCase() && a.id !== editing?.id)) errors.push("Another account already has that name.");
  let normal: Side | null = type in TYPE_INFO ? TYPE_INFO[type].normal : null;
  if (type === "other") { normal = f.normal === "debit" || f.normal === "credit" ? f.normal : editing?.normal ?? null; if (!normal) errors.push("Choose whether this is income (credit) or an expense (debit)."); }
  if (editing) {
    if (editing.system_key && type !== editing.type) errors.push("This account is used by automatic postings, so its type cannot change.");
    if (hasHistory && type !== editing.type) errors.push("This account has transactions, so its type cannot change. Add a new account instead.");
    if (hasHistory && editing.type === "other" && normal !== editing.normal) errors.push("This account has transactions, so its side cannot change.");
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { number: num!, label: label!, type, normal: normal as Side } };
}

/** Deactivating hides an account from pickers. History is untouched. Accounts the automatic postings rely on stay active. */
export function deactivateProblem(a: Account): string | null {
  return a.system_key ? "This account is used by automatic postings, so it stays active. You can rename it." : null;
}

export const isIncomeStatementType = (t: AccountType): boolean => t !== "asset" && t !== "liability" && t !== "equity";
export const formatAccount = (a: { number: number; label: string }): string => `${a.number} ${a.label}`;
