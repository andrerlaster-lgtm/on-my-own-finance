import { parseDate } from "./dates";
import { sheetDate } from "./expenseImport";
import { MANUAL_SOURCES } from "./income";
import { PURPOSES, type Purpose } from "./mileage";
import { signedCents } from "./squareImport";
import type { Sheet } from "./xlsxRead";

/*
 * The master import: every sheet of every uploaded file is sorted into one kind, then each kind has its own reader.
 * Pure: no network, no files, no database. Columns are found by heading. Only the columns listed in each spec are read:
 * names, addresses, notes, payers and every other column are skipped unread. Text shown on the preview (item names,
 * purposes, payment methods, services) is used only for choosing where rows go and is never saved.
 * Every saved row gets an import key built from its own values plus how many identical rows came before it in the file,
 * so importing the same file again adds nothing.
 */
export type ImportKind = "square" | "square_items" | "square_summary" | "expenses" | "inventory" | "mileage" | "income";
export const KIND_LABELS: Record<ImportKind, string> = {
  square: "Square transactions (income)", square_items: "Square item details (services)", square_summary: "Square sales summary",
  expenses: "Expenses", inventory: "Inventory (supplies bought or on hand)", mileage: "Mileage log", income: "Cash, check and other income",
};
export const CHOOSABLE: ImportKind[] = ["expenses", "inventory", "mileage", "income"];

export const hnorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
type Spec = Record<string, readonly string[]>;
export type Cols<S extends Spec> = Partial<Record<keyof S, number>>;

/** The first of the top 5 rows that names every required column; returns where each spec field is. */
export function findColumns<S extends Spec>(rows: readonly string[][], spec: S, required: readonly (keyof S)[]): { at: number; idx: Cols<S> } | null {
  for (let at = 0; at < Math.min(5, rows.length); at++) {
    const names = rows[at].map(hnorm), idx: Cols<S> = {};
    for (const f of Object.keys(spec) as (keyof S)[]) { const i = names.findIndex((h) => spec[f].includes(h)); if (i >= 0) idx[f] = i; }
    if (required.every((f) => idx[f] !== undefined)) return { at, idx };
  }
  return null;
}

const has = (names: Set<string>, list: readonly string[]) => list.some((n) => names.has(n));
/** What kind of data a sheet holds, from its headings. null = not recognized. */
export function detectKind(sheet: Sheet): ImportKind | null {
  const first = hnorm(sheet.rows[0]?.[0] ?? "");
  if (first.startsWith("salessummary")) return "square_summary";
  for (const row of sheet.rows.slice(0, 5)) {
    const n = new Set(row.map(hnorm));
    if (n.has("totalcollected")) return "square";
    if (n.has("item") && n.has("qty") && (n.has("paymentid") || n.has("transactionid"))) return "square_items";
    if (has(n, MILEAGE.miles) || (has(n, MILEAGE.odoStart) && has(n, MILEAGE.odoEnd))) return "mileage";
    if (has(n, INVENTORY.qty) && has(n, INVENTORY.item)) return "inventory";
    if (has(n, INCOME.amount) && has(n, ["revenue", "gross", "grossrevenue", "amountreceived", "received", "income", "tip", "tips", "deposit", "deposits", "paymentreceived"])) return "income";
    if (has(n, ["amount", "amountpaid", "cost", "price", "amountusd"])) return "expenses";
  }
  return null;
}

/* ---------------- shared pieces ---------------- */
export interface Flag { sheet: string; row: number; reason: string }
export interface Choice<T extends string> { label: string; count: number; total: number; guess: T | "skip"; guessed: boolean; note?: string }
class Groups<T extends string> {
  list: Choice<T>[] = []; private at = new Map<string, number>();
  add(label: string, amount: number, guess: () => { guess: T | "skip"; guessed: boolean; note?: string }): number {
    const k = label.toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
    let g = this.at.get(k);
    if (g === undefined) { g = this.list.length; this.at.set(k, g); this.list.push({ label: label.slice(0, 60) || "(blank)", count: 0, total: 0, ...guess() }); }
    this.list[g].count++; this.list[g].total += amount;
    return g;
  }
}
class Occurrence { private seen = new Map<string, number>(); next(k: string) { const n = (this.seen.get(k) ?? 0) + 1; this.seen.set(k, n); return n; } }
/** A short, stable fingerprint (FNV-1a) so a long item name fits inside an import key without storing the name twice. */
export function shortHash(s: string): string { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); }
const pick = <T extends string>(label: string, rules: { test: RegExp; to: T | "skip"; note?: string }[], fallback: T) => {
  const l = label.toLowerCase(), r = rules.find((x) => x.test.test(l));
  return r ? { guess: r.to, guessed: true, note: r.note } : { guess: fallback, guessed: true };
};
const plainNumber = (raw: string): number | null => { const s = raw.trim().replace(/[,\s]/g, ""); return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null; };

/** One section's rows, before and after the owner's choices. */
export interface Planned<R> { add: R[]; notChosen: number; alreadyImported: number; matchedHandEntered: number }
export function planRows<R extends { key: string }>(rows: readonly R[], keep: (r: R) => boolean, alreadyImported: ReadonlySet<string>, hand?: { pair: (r: R) => string; counts: ReadonlyMap<string, number> }): Planned<R> {
  const left = new Map(hand?.counts ?? []), out: Planned<R> = { add: [], notChosen: 0, alreadyImported: 0, matchedHandEntered: 0 };
  for (const r of rows) {
    if (!keep(r)) { out.notChosen++; continue; }
    if (alreadyImported.has(r.key)) { out.alreadyImported++; continue; }
    if (hand) { const p = hand.pair(r), n = left.get(p) ?? 0; if (n > 0) { left.set(p, n - 1); out.matchedHandEntered++; continue; } }
    out.add.push(r);
  }
  return out;
}

/* ---------------- inventory ---------------- */
const INVENTORY = {
  date: ["date", "purchasedate", "datepurchased", "datereceived", "received", "orderdate", "dateordered"],
  item: ["item", "itemname", "product", "productname", "supply", "supplies", "name", "description"],
  qty: ["qty", "quantity", "units", "count", "onhand", "quantityonhand", "qtyonhand", "numberofunits"],
  unitCost: ["unitcost", "costperunit", "priceperunit", "unitprice", "costeach", "priceeach", "each"],
  totalCost: ["totalcost", "cost", "total", "price", "amount", "totalprice", "amountpaid", "linetotal"],
  unit: ["unit", "uom", "unitofmeasure"],
  category: ["category", "type", "itemcategory"],
  lot: ["lot", "lotnumber", "lotno", "batch", "batchnumber"],
  expiry: ["expiry", "expiration", "expires", "expirationdate", "expirydate", "exp", "expdate", "bestby", "useby"],
} as const;
export interface InventoryRow { key: string; sheet: number; item: number; moved_on: string | null; quantity: number; unit_cost_cents: number | null; lot_number: string | null; expires_on: string | null }
export interface InventoryItemGroup { label: string; unit: string; category: string; count: number; quantity: number }
export interface InventoryParse { sheets: { name: string; rows: number; skipped: number; opening: boolean; undated: number; uncosted: number }[]; items: InventoryItemGroup[]; rows: InventoryRow[]; flags: Flag[]; rounded: number }
const LOT = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/;

export function parseInventory(sheets: readonly { index: number; sheet: Sheet }[]): InventoryParse {
  const out: InventoryParse = { sheets: [], items: [], rows: [], flags: [], rounded: 0 }, itemAt = new Map<string, number>(), occ = new Occurrence();
  for (const { index, sheet } of sheets) {
    const sum = { name: sheet.name, rows: 0, skipped: 0, opening: /open|start|on ?hand|count|beginning/i.test(sheet.name), undated: 0, uncosted: 0 };
    out.sheets[index] = sum;
    const h = findColumns(sheet.rows, INVENTORY, ["item", "qty"]);
    if (!h) continue;
    sheet.rows.slice(h.at + 1).forEach((rec, i) => {
      const row = h.at + 2 + i, get = (f: keyof typeof INVENTORY) => (h.idx[f] === undefined ? "" : (rec[h.idx[f]!] ?? "").trim());
      const flag = (reason: string) => { sum.skipped++; out.flags.push({ sheet: sheet.name, row, reason }); };
      const label = get("item").replace(/\s+/g, " "), qtyRaw = get("qty");
      if (label === "" && qtyRaw === "") return;
      if (label === "") return flag("no item name");
      if (label.length > 80) return flag("item name longer than 80 characters");
      const q = plainNumber(qtyRaw);
      if (q === null || !Number.isInteger(q) || q < 1 || q > 1_000_000) return flag(qtyRaw === "" ? "no quantity" : "quantity is not a whole number from 1 to 1,000,000");
      const dateRaw = get("date"), moved_on = dateRaw === "" ? null : sheetDate(dateRaw);
      if (dateRaw !== "" && !moved_on) return flag("date not readable");
      let unit_cost_cents: number | null = null;
      const uc = get("unitCost"), tc = get("totalCost");
      if (uc !== "") { unit_cost_cents = signedCents(uc, false); if (unit_cost_cents === null || unit_cost_cents < 0) return flag("cost per unit is not readable"); }
      else if (tc !== "") {
        const t = signedCents(tc, false);
        if (t === null || t < 0) return flag("cost is not readable");
        unit_cost_cents = Math.round(t / q);
        if (unit_cost_cents * q !== t) out.rounded++;
      }
      if (unit_cost_cents !== null && unit_cost_cents > 100_000_000) return flag("cost per unit is too large");
      const lot = get("lot"), expRaw = get("expiry");
      if (lot !== "" && !LOT.test(lot)) return flag("lot number has characters other than letters, numbers and . _ / -");
      const expires_on = expRaw === "" ? null : sheetDate(expRaw);
      if (expRaw !== "" && !expires_on) return flag("expiry date not readable");
      const ik = label.toLowerCase();
      let item = itemAt.get(ik);
      if (item === undefined) {
        item = out.items.length; itemAt.set(ik, item);
        const unit = get("unit").slice(0, 20) || "each", category = get("category").slice(0, 40) || "General";
        out.items.push({ label, unit, category, count: 0, quantity: 0 });
      }
      out.items[item].count++; out.items[item].quantity += q;
      if (!moved_on) sum.undated++;
      if (unit_cost_cents === null) sum.uncosted++;
      const base = `${moved_on ?? "nodate"}|${q}|${unit_cost_cents ?? "x"}|${shortHash(ik)}|${lot}`;
      out.rows.push({ key: `i1:${shortHash(base)}|${occ.next(base)}`, sheet: index, item, moved_on, quantity: q, unit_cost_cents, lot_number: lot || null, expires_on });
      sum.rows++;
    });
  }
  return out;
}

/* ---------------- mileage ---------------- */
const MILEAGE = {
  date: ["date", "tripdate", "day", "datedriven"],
  miles: ["miles", "distance", "mileage", "milesdriven", "totalmiles", "businessmiles", "tripmiles"],
  purpose: ["purpose", "businesspurpose", "reason", "trippurpose", "type", "category"],
  odoStart: ["odometerstart", "startodometer", "odostart", "startodo", "beginningodometer", "odometerbegin", "startingodometer", "beginodometer"],
  odoEnd: ["odometerend", "endodometer", "odoend", "endodo", "endingodometer", "odometerfinish", "finishodometer"],
} as const;
export interface TripRow { key: string; sheet: number; group: number; driven_on: string; miles_tenths: number; odometer_start: number | null; odometer_end: number | null }
export interface MileageParse { sheets: { name: string; rows: number; skipped: number; miles_tenths: number }[]; groups: Choice<Purpose>[]; rows: TripRow[]; flags: Flag[]; rounded: number; odometerDropped: number }
const PURPOSE_RULES: { test: RegExp; to: Purpose | "skip"; note?: string }[] = [
  { test: /personal|commut|home to/, to: "skip", note: "Personal and commuting miles are not business miles." },
  { test: /patient|visit|draw|appointment|client|mobile|house ?call|collection/, to: "patient_visits" },
  { test: /lab|drop/, to: "lab_dropoff" },
  { test: /suppl|store|pick ?up|shop/, to: "supply_run" },
  { test: /bank|post|office|admin|errand|mail/, to: "admin_errand" },
];
export function parseMileage(sheets: readonly { index: number; sheet: Sheet }[]): MileageParse {
  const out: MileageParse = { sheets: [], groups: [], rows: [], flags: [], rounded: 0, odometerDropped: 0 }, groups = new Groups<Purpose>(), occ = new Occurrence();
  for (const { index, sheet } of sheets) {
    const sum = { name: sheet.name, rows: 0, skipped: 0, miles_tenths: 0 };
    out.sheets[index] = sum;
    const h = findColumns(sheet.rows, MILEAGE, ["date"]);
    if (!h || (h.idx.miles === undefined && (h.idx.odoStart === undefined || h.idx.odoEnd === undefined))) continue;
    sheet.rows.slice(h.at + 1).forEach((rec, i) => {
      const row = h.at + 2 + i, get = (f: keyof typeof MILEAGE) => (h.idx[f] === undefined ? "" : (rec[h.idx[f]!] ?? "").trim());
      const flag = (reason: string) => { sum.skipped++; out.flags.push({ sheet: sheet.name, row, reason }); };
      const milesRaw = get("miles"), s = plainNumber(get("odoStart")), e = plainNumber(get("odoEnd"));
      if (milesRaw === "" && (s === null || e === null)) { if (get("date") === "") return; return flag("no miles"); }
      const driven_on = sheetDate(get("date"));
      if (!driven_on) return flag(get("date") === "" ? "no date (a total line?)" : "date not readable");
      const miles = milesRaw !== "" ? plainNumber(milesRaw) : e! - s!;
      if (miles === null) return flag("miles not readable");
      const tenths = Math.round(miles * 10);
      if (Math.abs(tenths - miles * 10) > 1e-6) out.rounded++;
      if (tenths < 1 || tenths > 10_000) return flag("miles must be from 0.1 to 1000");
      let odometer_start: number | null = null, odometer_end: number | null = null;
      if (s !== null && e !== null && Number.isInteger(s) && Number.isInteger(e) && s >= 0 && e >= s && e <= 9_999_999) { odometer_start = s; odometer_end = e; }
      else if (get("odoStart") !== "" || get("odoEnd") !== "") out.odometerDropped++;
      const purpose = get("purpose");
      const group = groups.add(purpose === "" ? "No purpose given" : purpose, tenths, () => (purpose === "" ? { guess: "patient_visits" as const, guessed: true } : exactPurpose(purpose) ?? pick<Purpose>(purpose, PURPOSE_RULES, "other")));
      const base = `${driven_on}|${tenths}`;
      out.rows.push({ key: `m1:${base}|${occ.next(base)}`, sheet: index, group, driven_on, miles_tenths: tenths, odometer_start, odometer_end });
      sum.rows++; sum.miles_tenths += tenths;
    });
  }
  out.groups = groups.list;
  return out;
}
const exactPurpose = (label: string) => { const p = PURPOSES.find((x) => hnorm(x.id) === hnorm(label) || hnorm(x.label) === hnorm(label)); return p ? { guess: p.id, guessed: false } : null; };

/* ---------------- cash, check and other income ---------------- */
const INCOME = {
  date: ["date", "datereceived", "datepaid", "paymentdate", "depositdate", "deposited"],
  amount: ["revenue", "gross", "grossrevenue", "amountreceived", "amount", "payment", "paymentreceived", "income", "deposit", "deposits", "amountpaid", "total", "paid"],
  tip: ["tip", "tips", "gratuity"],
  fee: ["fee", "fees", "processingfee", "processingfees"],
  source: ["source", "method", "paymentmethod", "paymenttype", "paidwith", "type", "howpaid", "paymentform"],
  visits: ["visits", "draws", "appointments", "numberofvisits"],
} as const;
export type Source = (typeof MANUAL_SOURCES)[number]["id"];
export interface IncomeRow { key: string; sheet: number; group: number; occurred_on: string; amount_cents: number; tip_cents: number; fee_cents: number; visits: number }
export interface IncomeParse { sheets: { name: string; rows: number; skipped: number; total: number }[]; groups: Choice<Source>[]; rows: IncomeRow[]; flags: Flag[]; hasTip: boolean }
const SOURCE_RULES: { test: RegExp; to: Source | "skip"; note?: string }[] = [
  { test: /square|card|credit|debit|visa|master|amex|tap|online payment/, to: "skip", note: "Card payments come from the Square import; importing them here would count them twice." },
  { test: /cash ?app/, to: "skip", note: "If this came through Square, it is already in the Square import." },
  { test: /cash/, to: "cash" },
  { test: /check|cheque|chk/, to: "check" },
  { test: /zelle|venmo|paypal|ach|bank|transfer|direct|deposit|wire|eft/, to: "bank_transfer" },
];
export function parseIncome(sheets: readonly { index: number; sheet: Sheet }[]): IncomeParse {
  const out: IncomeParse = { sheets: [], groups: [], rows: [], flags: [], hasTip: false }, groups = new Groups<Source>(), occ = new Occurrence();
  for (const { index, sheet } of sheets) {
    const sum = { name: sheet.name, rows: 0, skipped: 0, total: 0 };
    out.sheets[index] = sum;
    const h = findColumns(sheet.rows, INCOME, ["amount"]);
    if (!h) continue;
    if (h.idx.tip !== undefined) out.hasTip = true;
    sheet.rows.slice(h.at + 1).forEach((rec, i) => {
      const row = h.at + 2 + i, get = (f: keyof typeof INCOME) => (h.idx[f] === undefined ? "" : (rec[h.idx[f]!] ?? "").trim());
      const flag = (reason: string) => { sum.skipped++; out.flags.push({ sheet: sheet.name, row, reason }); };
      const aRaw = get("amount"), tRaw = get("tip");
      if (aRaw === "" && tRaw === "") return;
      const a = signedCents(aRaw, true), t = signedCents(tRaw, true), f = signedCents(get("fee"), true);
      if (a === null || t === null || f === null) return flag("an amount is not readable");
      const occurred_on = sheetDate(get("date"));
      if (!occurred_on) return flag(get("date") === "" ? "no date (a total line?)" : "date not readable");
      if (a < 0 || t < 0) return flag("negative amount (refunds are not imported)");
      if (a + t === 0) return flag("amount is zero");
      const fee = Math.abs(f);
      if (a > 99_999_999_999 || t > 99_999_999_999) return flag("amount is too large");
      const vRaw = get("visits"), v = vRaw === "" ? 0 : plainNumber(vRaw);
      if (v === null || !Number.isInteger(v) || v < 0 || v > 1000) return flag("visits is not a whole number from 0 to 1000");
      const src = get("source");
      const group = groups.add(src === "" ? "No payment method given" : src, a + t, () => (src === "" ? { guess: "other" as const, guessed: true } : exactSource(src) ?? pick<Source>(src, SOURCE_RULES, "other")));
      const base = `${occurred_on}|${a}|${t}`;
      out.rows.push({ key: `n1:${base}|${occ.next(base)}`, sheet: index, group, occurred_on, amount_cents: a, tip_cents: t, fee_cents: fee, visits: v });
      sum.rows++; sum.total += a + t;
    });
  }
  out.groups = groups.list;
  return out;
}
const exactSource = (label: string) => { const s = MANUAL_SOURCES.find((x) => hnorm(x.id) === hnorm(label) || hnorm(x.label) === hnorm(label)); return s ? { guess: s.id, guessed: false } : null; };
/** Revenue and tip for one row, given whether the amount column already includes the tip. Null when the tip is larger than the amount. */
export function splitIncome(r: IncomeRow, amountIncludesTip: boolean): { gross: number; tip: number } | null {
  if (!amountIncludesTip) return { gross: r.amount_cents, tip: r.tip_cents };
  return r.tip_cents > r.amount_cents ? null : { gross: r.amount_cents - r.tip_cents, tip: r.tip_cents };
}

/* ---------------- Square item details -> services ---------------- */
const ITEMS = { item: ["item"], paymentId: ["paymentid"], transactionId: ["transactionid"], event: ["eventtype"] } as const;
const ID = /^[A-Za-z0-9_-]{4,64}$/;
export interface ServicePayment { external_id: string; groups: number[] }
export interface ServiceParse { groups: { label: string; count: number }[]; payments: ServicePayment[]; refundsSkipped: number; flags: Flag[] }
export function parseServices(sheets: readonly { index: number; sheet: Sheet }[]): ServiceParse {
  const out: ServiceParse = { groups: [], payments: [], refundsSkipped: 0, flags: [] }, at = new Map<string, number>(), byPay = new Map<string, Set<number>>();
  for (const { sheet } of sheets) {
    const h = findColumns(sheet.rows, ITEMS, ["item"]);
    if (!h || (h.idx.paymentId === undefined && h.idx.transactionId === undefined)) continue;
    sheet.rows.slice(h.at + 1).forEach((rec, i) => {
      const get = (f: keyof typeof ITEMS) => (h.idx[f] === undefined ? "" : (rec[h.idx[f]!] ?? "").trim());
      if (/refund/i.test(get("event"))) { out.refundsSkipped++; return; }
      const pid = get("paymentId"), tid = get("transactionId");
      const ext = pid !== "" ? (ID.test(pid) ? pid : null) : tid !== "" && ID.test(tid) ? `t:${tid}` : null;
      const label = get("item").replace(/\s+/g, " ").slice(0, 60) || "(no item name)";
      if (!ext) { out.flags.push({ sheet: sheet.name, row: h.at + 2 + i, reason: "missing or unreadable payment id" }); return; }
      const k = label.toLowerCase();
      let g = at.get(k);
      if (g === undefined) { g = out.groups.length; at.set(k, g); out.groups.push({ label, count: 0 }); }
      out.groups[g].count++;
      (byPay.get(ext) ?? byPay.set(ext, new Set()).get(ext)!).add(g);
    });
  }
  out.payments = [...byPay].map(([external_id, gs]) => ({ external_id, groups: [...gs].sort((a, b) => a - b) }));
  return out;
}
/** Which revenue account each payment gets. A payment whose services map to two different accounts is left alone (one entry can't be split). */
export function planServices(payments: readonly ServicePayment[], map: ReadonlyMap<number, number>): { assign: { external_id: string; account_id: number }[]; mixed: number; unmapped: number } {
  const out = { assign: [] as { external_id: string; account_id: number }[], mixed: 0, unmapped: 0 };
  for (const p of payments) {
    const accs = new Set(p.groups.map((g) => map.get(g)).filter((a): a is number => a !== undefined));
    if (accs.size === 0) out.unmapped++;
    else if (accs.size > 1) out.mixed++;
    else out.assign.push({ external_id: p.external_id, account_id: [...accs][0] });
  }
  return out;
}

/* ---------------- payloads (rows travel to the confirm step and are re-checked there) ---------------- */
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const isDate = (v: unknown): v is string => typeof v === "string" && parseDate(v) === v;
const isKey = (v: unknown, prefix: string): v is string => typeof v === "string" && v.length <= 60 && v.startsWith(prefix) && /^[a-z0-9]+:[A-Za-z0-9|:._/-]+$/.test(v);
function decode(raw: string, max: number): unknown[] | null {
  try { const j = JSON.parse(raw); return j && j.v === 1 && Array.isArray(j.rows) && j.rows.length <= max ? (j.rows as unknown[]) : null; } catch { return null; }
}
export const MAX_ROWS = 5_000;
const uniqueKeys = <R extends { key: string }>(rows: R[]) => new Set(rows.map((r) => r.key)).size === rows.length;

export const serializeInventory = (p: InventoryParse) => JSON.stringify({ v: 1, items: p.items.map((i) => [i.label, i.unit, i.category]), rows: p.rows.map((r) => [r.key, r.sheet, r.item, r.moved_on, r.quantity, r.unit_cost_cents, r.lot_number, r.expires_on]) });
export function parseInventoryPayload(raw: string): { items: { label: string; unit: string; category: string }[]; rows: InventoryRow[] } | null {
  const rows = decode(raw, MAX_ROWS);
  let items: unknown;
  try { items = JSON.parse(raw).items; } catch { return null; }
  if (!rows || !Array.isArray(items) || items.length > MAX_ROWS) return null;
  const its: { label: string; unit: string; category: string }[] = [];
  for (const it of items) {
    if (!Array.isArray(it) || it.length !== 3 || !it.every((x) => typeof x === "string")) return null;
    const [label, unit, category] = it as string[];
    if (label.trim() === "" || label.length > 80 || unit.trim() === "" || unit.length > 20 || category.trim() === "" || category.length > 40) return null;
    its.push({ label, unit, category });
  }
  const out: InventoryRow[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== 8) return null;
    const [key, sheet, item, moved_on, quantity, cost, lot, exp] = r;
    if (!isKey(key, "i1:") || !isInt(sheet, 0, 999) || !isInt(item, 0, its.length - 1) || !(moved_on === null || isDate(moved_on)) || !isInt(quantity, 1, 1_000_000)) return null;
    if (!(cost === null || isInt(cost, 0, 100_000_000)) || !(lot === null || (typeof lot === "string" && LOT.test(lot))) || !(exp === null || isDate(exp))) return null;
    out.push({ key, sheet, item, moved_on, quantity, unit_cost_cents: cost, lot_number: lot, expires_on: exp });
  }
  return uniqueKeys(out) ? { items: its, rows: out } : null;
}

export const serializeMileage = (p: MileageParse) => JSON.stringify({ v: 1, g: p.groups.length, rows: p.rows.map((r) => [r.key, r.sheet, r.group, r.driven_on, r.miles_tenths, r.odometer_start, r.odometer_end]) });
export function parseMileagePayload(raw: string): { groups: number; rows: TripRow[] } | null {
  const rows = decode(raw, MAX_ROWS);
  let g: unknown;
  try { g = JSON.parse(raw).g; } catch { return null; }
  if (!rows || !isInt(g, 0, MAX_ROWS)) return null;
  const out: TripRow[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== 7) return null;
    const [key, sheet, group, driven_on, tenths, s, e] = r;
    if (!isKey(key, "m1:") || key !== `m1:${driven_on}|${tenths}|${String(key).split("|")[2]}` || !isInt(sheet, 0, 999) || !isInt(group, 0, g - 1) || !isDate(driven_on) || !isInt(tenths, 1, 10_000)) return null;
    if ((s === null) !== (e === null) || (s !== null && (!isInt(s, 0, 9_999_999) || !isInt(e, s as number, 9_999_999)))) return null;
    out.push({ key, sheet, group, driven_on, miles_tenths: tenths, odometer_start: s as number | null, odometer_end: e as number | null });
  }
  return uniqueKeys(out) ? { groups: g, rows: out } : null;
}

export const serializeIncome = (p: IncomeParse) => JSON.stringify({ v: 1, g: p.groups.length, rows: p.rows.map((r) => [r.key, r.sheet, r.group, r.occurred_on, r.amount_cents, r.tip_cents, r.fee_cents, r.visits]) });
export function parseIncomePayload(raw: string): { groups: number; rows: IncomeRow[] } | null {
  const rows = decode(raw, MAX_ROWS);
  let g: unknown;
  try { g = JSON.parse(raw).g; } catch { return null; }
  if (!rows || !isInt(g, 0, MAX_ROWS)) return null;
  const out: IncomeRow[] = [], M = 99_999_999_999;
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== 8) return null;
    const [key, sheet, group, d, a, t, f, v] = r;
    if (!isKey(key, "n1:") || key !== `n1:${d}|${a}|${t}|${String(key).split("|")[3]}` || !isInt(sheet, 0, 999) || !isInt(group, 0, g - 1) || !isDate(d)) return null;
    if (!isInt(a, 0, M) || !isInt(t, 0, M) || !isInt(f, 0, M) || a + t === 0 || !isInt(v, 0, 1000)) return null;
    out.push({ key, sheet, group, occurred_on: d, amount_cents: a, tip_cents: t, fee_cents: f, visits: v });
  }
  return uniqueKeys(out) ? { groups: g, rows: out } : null;
}

export const serializeServices = (p: ServiceParse) => JSON.stringify({ v: 1, g: p.groups.length, rows: p.payments.map((x) => [x.external_id, x.groups]) });
export function parseServicesPayload(raw: string): { groups: number; payments: ServicePayment[] } | null {
  const rows = decode(raw, 20_000);
  let g: unknown;
  try { g = JSON.parse(raw).g; } catch { return null; }
  if (!rows || !isInt(g, 0, MAX_ROWS)) return null;
  const out: ServicePayment[] = [], seen = new Set<string>();
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== 2 || typeof r[0] !== "string" || !/^(t:)?[A-Za-z0-9_-]{4,64}$/.test(r[0]) || seen.has(r[0]) || !Array.isArray(r[1]) || r[1].length === 0 || r[1].length > 50 || !r[1].every((x) => isInt(x, 0, (g as number) - 1))) return null;
    seen.add(r[0]);
    out.push({ external_id: r[0], groups: r[1] as number[] });
  }
  return { groups: g, payments: out };
}
