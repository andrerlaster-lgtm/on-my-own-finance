import { parseDate } from "./dates";
import { CATEGORIES, cleanVendor, type Category } from "./expenses";
import { signedCents } from "./squareImport";
import type { Sheet } from "./xlsxRead";

/*
 * Expense spreadsheet (Excel or CSV) -> expense rows. Pure: no network, no files, no database.
 * Columns are found by header name. Only the date, the amount (or the "with tax" amount when filled in), the category and an
 * optional vendor are kept. Descriptions are read only to suggest a category on the preview screen; they are never saved.
 * Rows with an amount but no date (usually total lines) are flagged and skipped.
 * Each row gets an import key (date | cents | how many times that date and amount appeared before it in the file), so
 * importing the same file again adds nothing.
 */
export const EXPENSE_LIMITS = { rows: 5_000 };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const COLUMNS = {
  date: ["date", "datepaid", "purchasedate", "spenton", "day"],
  amount: ["amount", "amountpaid", "cost", "price", "amountusd"],
  withTax: ["withtax", "amountwithtax", "totalwithtax"],
  category: ["category", "type", "expensetype"],
  description: ["description", "details", "item", "items", "memo", "notes", "note"],
  vendor: ["vendor", "store", "merchant", "payee", "seller"],
} as const;
type Field = keyof typeof COLUMNS;

export interface ExpenseRow { sheet: number; spent_on: string; amount_cents: number; group: number; key: string; vendor: string | null; withTax: boolean }
export interface Group { label: string; count: number; total: number; guess: Category | "skip"; guessed: boolean; note?: string }
export interface SheetSummary { name: string; rows: number; total: number; skipped: number; usable: boolean }
export interface ExpenseFlag { sheet: string; row: number; reason: string }
export type ExpenseParse =
  | { ok: false; error: string }
  | { ok: true; sheets: SheetSummary[]; rows: ExpenseRow[]; groups: Group[]; flags: ExpenseFlag[]; flagsTotal: number; withTaxUsed: number };

/** Header row: the first of the top 5 rows that names an amount column. */
function findHeader(rows: readonly string[][]): { at: number; idx: Partial<Record<Field, number>> } | null {
  for (let at = 0; at < Math.min(5, rows.length); at++) {
    const names = rows[at].map(norm), idx: Partial<Record<Field, number>> = {};
    for (const f of Object.keys(COLUMNS) as Field[]) { const i = names.findIndex((h) => (COLUMNS[f] as readonly string[]).includes(h)); if (i >= 0) idx[f] = i; }
    if (idx.amount !== undefined) return { at, idx };
  }
  return null;
}

/** "2026-03-04", "2026-03-04 00:00:00", "3/4/2026", "3/4/26" -> 2026-03-04. */
export function sheetDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}( |$)/.test(s)) return parseDate(s.slice(0, 10));
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return parseDate(`${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`);
}

/** Does this look like an expense list (has an amount column and no Square payment columns)? */
export function looksLikeExpenses(sheets: readonly Sheet[]): boolean {
  return sheets.some((s) => { const h = findHeader(s.rows); return h !== null && !s.rows[h.at].map(norm).includes("totalcollected"); });
}

const RULES: { test: RegExp; cat: Category | "skip"; note?: string }[] = [
  { test: /donat|charit/, cat: "skip", note: "Donations usually aren't business expenses. Ask your preparer." },
  { test: /\b(car|gas|fuel|oil change|vehicle|auto|tires?|parking|toll)\b/, cat: "skip", note: "If your preparer uses the standard mileage rate, don't also enter car costs." },
  { test: /insur/, cat: "insurance" },
  { test: /licen|permit|certif|\bfees?\b|bank/, cat: "licenses_fees" },
  { test: /subscri|software|website|domain|hosting|\bapps?\b/, cat: "software" },
  { test: /phone|internet|wi-?fi|cell/, cat: "phone_internet" },
  { test: /train|class|course|educat|\bceu/, cat: "training" },
  { test: /lawyer|legal|accountant|\bcpa\b|bookkeep|consult/, cat: "professional_services" },
  { test: /market|advert|flyer|business card|promo|\bads?\b|banner|sign/, cat: "advertising" },
  { test: /equip|chair|scale|thermo|centrifuge|sphyg|blood pressure|laptop|printer|cooler|bag/, cat: "equipment" },
  { test: /suppl|needle|tube|glove|gauze|bandage|alcohol|tourniquet|sharps|lancet|vacutainer|urine|\bcups?\b|\bhubs?\b|\bkits?\b|wipes|tape/, cat: "supplies" },
  { test: /misc|office|other/, cat: "other" },
];
export function guessCategory(label: string): { guess: Category | "skip"; guessed: boolean; note?: string } {
  const l = label.toLowerCase();
  const exact = CATEGORIES.find((c) => c.id === norm(l) || norm(c.label) === norm(l));
  if (exact) return { guess: exact.id, guessed: false };
  const r = RULES.find((x) => x.test.test(l));
  return r ? { guess: r.cat, guessed: true, note: r.note } : { guess: "other", guessed: true };
}

export function parseExpenseSheets(sheets: readonly Sheet[]): ExpenseParse {
  const summaries: SheetSummary[] = [], rows: ExpenseRow[] = [], flags: ExpenseFlag[] = [];
  const groups: Group[] = [], groupAt = new Map<string, number>(), seen = new Map<string, number>();
  let withTaxUsed = 0;
  sheets.forEach((sheet, si) => {
    const sum: SheetSummary = { name: sheet.name, rows: 0, total: 0, skipped: 0, usable: false };
    summaries.push(sum);
    const h = findHeader(sheet.rows);
    if (!h || sheet.rows[h.at].map(norm).includes("totalcollected")) return;
    sum.usable = true;
    const idx = { ...h.idx };
    const data = sheet.rows.slice(h.at + 1);
    if (idx.date === undefined) { // no "Date" heading: use the column that holds the most dates
      let best = -1, bestN = 0;
      const width = Math.max(0, ...data.map((r) => r.length));
      for (let c = 0; c < width; c++) { const n = data.filter((r) => sheetDate(r[c] ?? "") !== null).length; if (n > bestN) { best = c; bestN = n; } }
      if (best >= 0 && bestN * 2 >= data.filter((r) => (r[idx.amount!] ?? "") !== "").length) idx.date = best;
    }
    data.forEach((rec, i) => {
      const rowNo = h.at + 2 + i, get = (f: Field) => (idx[f] === undefined ? "" : (rec[idx[f]!] ?? "").trim());
      const flag = (reason: string) => { sum.skipped++; flags.push({ sheet: sheet.name, row: rowNo, reason }); };
      const amountRaw = get("amount"), taxRaw = get("withTax");
      if (amountRaw === "" && taxRaw === "") return; // blank or note line
      const base = signedCents(amountRaw, true), withTax = signedCents(taxRaw, true);
      const spent_on = sheetDate(get("date"));
      if (base === null || withTax === null) return flag("amount is not readable");
      const useTax = withTax > 0;
      const cents = useTax ? withTax : base;
      if (!spent_on) return flag(get("date") === "" ? "no date (a total line?)" : "date not readable");
      if (cents <= 0) return flag("amount is zero or negative");
      if (cents > 99_999_999_999) return flag("amount is too large");
      const cat = get("category"), desc = get("description");
      const label = cat !== "" ? cat : desc !== "" ? `No category: ${desc}` : "No category or description";
      const gk = (cat !== "" ? "c:" + cat : "d:" + desc).toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
      let g = groupAt.get(gk);
      if (g === undefined) { g = groups.length; groupAt.set(gk, g); groups.push({ label: label.slice(0, 60), count: 0, total: 0, ...guessCategory(cat !== "" ? cat : desc) }); }
      groups[g].count++; groups[g].total += cents;
      const pair = `${spent_on}|${cents}`, n = (seen.get(pair) ?? 0) + 1;
      seen.set(pair, n);
      const v = cleanVendor(get("vendor"));
      rows.push({ sheet: si, spent_on, amount_cents: cents, group: g, key: `x1:${pair}|${n}`, vendor: v === "bad" ? null : v, withTax: useTax });
      if (useTax) withTaxUsed++;
      sum.rows++; sum.total += cents;
    });
  });
  if (!summaries.some((s) => s.usable)) return { ok: false, error: "No sheet has an \"Amount\" column, so this doesn't look like an expense list. The first row of each sheet should name the columns, for example Date, Category, Description, Amount." };
  if (rows.length > EXPENSE_LIMITS.rows) return { ok: false, error: `More than ${EXPENSE_LIMITS.rows} expenses in one file. Split it into smaller files.` };
  return { ok: true, sheets: summaries, rows, groups, flags: flags.slice(0, 50), flagsTotal: flags.length, withTaxUsed };
}

/** The rows travel to the confirm step as this payload: only date, cents, sheet, group, key and vendor. Every value is re-checked there. */
export function serializeExpensePayload(rows: readonly ExpenseRow[], groupCount: number, sheetCount: number): string {
  return JSON.stringify({ v: 1, g: groupCount, s: sheetCount, rows: rows.map((r) => [r.sheet, r.spent_on, r.amount_cents, r.group, r.key, r.vendor]) });
}

export function parseExpensePayload(raw: string): { ok: true; rows: ExpenseRow[]; groupCount: number; sheetCount: number } | { ok: false; error: string } {
  const bad = { ok: false as const, error: "The import data was not readable. Choose the file again." };
  let j: { v?: number; g?: unknown; s?: unknown; rows?: unknown };
  try { j = JSON.parse(raw); } catch { return bad; }
  if (!j || j.v !== 1 || !Array.isArray(j.rows) || j.rows.length > EXPENSE_LIMITS.rows) return bad;
  const g = j.g, s = j.s;
  if (typeof g !== "number" || !Number.isSafeInteger(g) || g < 0 || g > EXPENSE_LIMITS.rows || typeof s !== "number" || !Number.isSafeInteger(s) || s < 0 || s > 50) return bad;
  const out: ExpenseRow[] = [], keys = new Set<string>();
  for (const r of j.rows as unknown[]) {
    if (!Array.isArray(r) || r.length !== 6) return bad;
    const [sheet, spent_on, cents, group, key, vendor] = r;
    if (!Number.isSafeInteger(sheet) || sheet < 0 || sheet >= s || !Number.isSafeInteger(group) || group < 0 || group >= g) return bad;
    if (typeof spent_on !== "string" || parseDate(spent_on) !== spent_on) return bad;
    if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 99_999_999_999) return bad;
    if (typeof key !== "string" || key !== `x1:${spent_on}|${cents}|${key.split("|")[2]}` || !/^\d{1,5}$/.test(key.split("|")[2] ?? "") || keys.has(key)) return bad;
    const v = vendor === null ? null : typeof vendor === "string" ? cleanVendor(vendor) : "bad";
    if (v === "bad" || (v !== null && v !== vendor)) return bad;
    keys.add(key);
    out.push({ sheet, spent_on, amount_cents: cents, group, key, vendor: v, withTax: false });
  }
  return { ok: true, rows: out, groupCount: g, sheetCount: s };
}

export interface PlanInput {
  sheets: ReadonlySet<number>; map: ReadonlyMap<number, Category | "skip">; skipMatches: boolean;
  alreadyImported: ReadonlySet<string>; handEntered: ReadonlyMap<string, number>; // "date|cents" -> how many hand-entered expenses have it
}
export interface Plan { add: (ExpenseRow & { category: Category })[]; notChosen: number; alreadyImported: number; matchedHandEntered: number }

/** What the import will do with the owner's choices. Rows in unticked sheets or "skip" groups are left out. */
export function planExpenseImport(rows: readonly ExpenseRow[], p: PlanInput): Plan {
  const left = new Map(p.handEntered), plan: Plan = { add: [], notChosen: 0, alreadyImported: 0, matchedHandEntered: 0 };
  for (const r of rows) {
    const cat = p.map.get(r.group);
    if (!p.sheets.has(r.sheet) || cat === undefined || cat === "skip") { plan.notChosen++; continue; }
    if (p.alreadyImported.has(r.key)) { plan.alreadyImported++; continue; }
    const pair = `${r.spent_on}|${r.amount_cents}`, n = left.get(pair) ?? 0;
    if (p.skipMatches && n > 0) { left.set(pair, n - 1); plan.matchedHandEntered++; continue; }
    plan.add.push({ ...r, category: cat });
  }
  return plan;
}

export const isCategory = (v: string): v is Category => CATEGORIES.some((c) => c.id === v);
