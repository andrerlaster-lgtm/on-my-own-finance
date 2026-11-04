import { parseDate } from "./dates";
import { COMPLETED_STATUSES, FAILED_WORDS, LIMITS, PAYMENT_EVENT_WORDS, REFUND_WORDS, REQUIRED_FIELDS, SQUARE_COLUMNS, type SquareField } from "./squareFormat";

/*
 * Square Transactions CSV -> income rows. Pure: no network, no files, no database.
 * Only the columns named in squareFormat.ts are read; each row is reduced to five fields (payment id, date, revenue, tip, fee)
 * and the rest of the line is dropped at once. Refund, failed and unclear rows are counted and explained by row number and a
 * fixed reason; no text from the file is kept for them.
 */
export type Category = "refund" | "failed" | "uncertain";
export interface ImportRow { external_id: string; occurred_on: string; gross_cents: number; tip_cents: number; fee_cents: number }
export interface Counts { read: number; importable: number; duplicateInFile: number; refund: number; failed: number; uncertain: number }
export interface Flag { row: number; category: Category; reason: string }
export type ParseOutcome =
  | { ok: false; error: string }
  | { ok: true; rows: ImportRow[]; counts: Counts; flags: Flag[]; unknownStatuses: string[]; firstDate: string | null; lastDate: string | null };

const norm = (s: string) => s.replace(/^﻿/, "").trim().replace(/\s+/g, " ").toLowerCase();

function* csvRecords(text: string): Generator<string[]> {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  let field = "", rec: string[] = [], inQ = false, any = false;
  while (i < n) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && field === "") { inQ = true; any = true; i++; continue; }
    if (c === ",") { rec.push(field); field = ""; any = true; i++; continue; }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      i++;
      if (any || field !== "" || rec.length) { rec.push(field); yield rec; }
      rec = []; field = ""; any = false; continue;
    }
    field += c; any = true; i++;
  }
  if (inQ) throw new Error("quote");
  if (any || field !== "" || rec.length) { rec.push(field); yield rec; }
}

/** "12.50", "$1,234.00", "-3", "(3.00)" -> signed cents. Empty -> 0 when allowEmpty, otherwise null. Anything else -> null. */
export function signedCents(raw: string, allowEmpty: boolean): number | null {
  let s = raw.trim().replace(/[$,\s]/g, "");
  if (s === "") return allowEmpty ? 0 : null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [d, c = ""] = s.split(".");
  const v = Number(d) * 100 + Number(c.padEnd(2, "0"));
  return neg ? -v : v;
}

function squareDate(raw: string): string | null {
  const s = raw.trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  return parseDate(us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : s);
}

const ID = /^[A-Za-z0-9_-]{4,64}$/;
const safeStatus = (s: string) => (/^[A-Za-z][A-Za-z _-]{0,29}$/.test(s) ? s : "(unreadable)");

export function parseSquareCsv(text: string): ParseOutcome {
  if (text.length > LIMITS.fileBytes) return { ok: false, error: "That file is too large (2 MB limit). Export a shorter date range." };
  const it = (() => { try { return csvRecords(text); } catch { return null; } })();
  let header: string[] | undefined;
  const rows: ImportRow[] = [], flags: Flag[] = [], seen = new Set<string>(), unknown = new Set<string>();
  const counts: Counts = { read: 0, importable: 0, duplicateInFile: 0, refund: 0, failed: 0, uncertain: 0 };
  let first: string | null = null, last: string | null = null;
  let idx: Partial<Record<SquareField, number>> = {};
  try {
    let n = 0;
    for (const rec of it ?? []) {
      n++;
      if (!header) {
        header = rec;
        const names = header.map(norm);
        const missing: string[] = [];
        for (const f of Object.keys(SQUARE_COLUMNS) as SquareField[]) {
          const hits = names.flatMap((h, i) => (SQUARE_COLUMNS[f].some((a) => norm(a) === h) ? [i] : []));
          if (hits.length > 1) return { ok: false, error: `The column "${SQUARE_COLUMNS[f][0]}" appears more than once, so it can't be read safely.` };
          if (hits.length === 1) idx[f] = hits[0];
        }
        for (const f of REQUIRED_FIELDS) if (idx[f] === undefined) missing.push(SQUARE_COLUMNS[f][0]);
        if (idx.paymentId === undefined && idx.transactionId === undefined) missing.push(`${SQUARE_COLUMNS.paymentId[0]} or ${SQUARE_COLUMNS.transactionId[0]}`);
        if (missing.length) return { ok: false, error: `This doesn't look like the expected Square Transactions export. Missing column(s): ${missing.join(", ")}. If Square's headers changed, update src/lib/squareFormat.ts.` };
        continue;
      }
      if (counts.read >= LIMITS.records) return { ok: false, error: "Too many rows in one file. Export a shorter date range." };
      counts.read++;
      const row = n; // spreadsheet row number (header = 1)
      const get = (f: SquareField) => (idx[f] === undefined ? "" : (rec[idx[f]!] ?? "").trim());
      const flag = (category: Category, reason: string) => { counts[category]++; flags.push({ row, category, reason }); };

      const status = get("status"), event = get("eventType");
      const total = signedCents(get("totalCollected"), false);
      const partial = signedCents(get("partialRefunds"), true);
      // refunds first: they are never income
      if (REFUND_WORDS.test(event)) { flag("refund", "event type is a refund"); continue; }
      if (REFUND_WORDS.test(status)) { flag("refund", "status says refunded"); continue; }
      if (partial !== null && partial !== 0) { flag("refund", "has a partial refund amount"); continue; }
      if (get("refundReason") !== "") { flag("refund", "has a refund reason"); continue; }
      if (total !== null && total < 0) { flag("refund", "negative amount"); continue; }
      if (FAILED_WORDS.test(status) || FAILED_WORDS.test(event)) { flag("failed", "payment did not complete"); continue; }
      if (event !== "" && !PAYMENT_EVENT_WORDS.test(event)) { flag("uncertain", "event type is not a payment"); continue; }
      if (!COMPLETED_STATUSES.includes(status.toLowerCase())) { unknown.add(safeStatus(status)); flag("uncertain", "status is not a completed payment"); continue; }

      const tip = signedCents(get("tip"), true), tax = signedCents(get("tax"), true), fees = signedCents(get("fees"), true), net = signedCents(get("netTotal"), false);
      const date = squareDate(get("date"));
      const pid = get("paymentId"), tid = get("transactionId");
      const external_id = pid !== "" ? (ID.test(pid) ? pid : null) : tid !== "" && ID.test(tid) ? `t:${tid}` : null;
      if (!date) { flag("uncertain", "date not readable"); continue; }
      if (!external_id) { flag("uncertain", "missing or unreadable payment id"); continue; }
      if (total === null || tip === null || tax === null || fees === null || net === null) { flag("uncertain", "an amount is not readable"); continue; }
      if (tax !== 0) { flag("uncertain", "has sales tax (none expected)"); continue; }
      if (tip < 0) { flag("uncertain", "negative tip"); continue; }
      const fee = Math.abs(fees), gross = total - tip; // tax is 0 here (rows with sales tax were flagged above), so revenue + tip = Total Collected exactly
      if (gross < 0) { flag("uncertain", "tip is larger than the total"); continue; }
      if (gross + tip === 0) { flag("uncertain", "nothing was collected"); continue; }
      if (fee > gross + tip) { flag("uncertain", "fee is larger than the payment"); continue; }
      if (net !== total - fee) { flag("uncertain", "net total doesn't match total minus fees"); continue; }
      if (seen.has(external_id)) { counts.duplicateInFile++; continue; }
      seen.add(external_id);
      if (rows.length >= LIMITS.importableRows) return { ok: false, error: `More than ${LIMITS.importableRows} payments in one file. Export a shorter date range.` };
      rows.push({ external_id, occurred_on: date, gross_cents: gross, tip_cents: tip, fee_cents: fee });
      if (first === null || date < first) first = date;
      if (last === null || date > last) last = date;
    }
  } catch {
    return { ok: false, error: "The file has an unclosed quotation mark, so it can't be read." };
  }
  if (!header) return { ok: false, error: "The file is empty." };
  counts.importable = rows.length;
  return { ok: true, rows, counts, flags, unknownStatuses: [...unknown].slice(0, 10), firstDate: first, lastDate: last };
}

export interface Preview {
  counts: Counts; newCount: number; alreadyImported: number;
  revenue: number; tips: number; fees: number; netAfterFees: number;
  firstDate: string | null; lastDate: string | null; flags: Flag[]; flagsTotal: number; unknownStatuses: string[];
}
export const FLAG_DISPLAY_LIMIT = 30;

/** What the preview screen shows. Totals cover only rows that would actually be added. */
export function buildPreview(out: Extract<ParseOutcome, { ok: true }>, existing: ReadonlySet<string>): Preview {
  const fresh = out.rows.filter((r) => !existing.has(r.external_id));
  const revenue = fresh.reduce((s, r) => s + r.gross_cents, 0), tips = fresh.reduce((s, r) => s + r.tip_cents, 0), fees = fresh.reduce((s, r) => s + r.fee_cents, 0);
  return {
    counts: out.counts, newCount: fresh.length, alreadyImported: out.rows.length - fresh.length, revenue, tips, fees, netAfterFees: revenue + tips - fees,
    firstDate: out.firstDate, lastDate: out.lastDate, flags: out.flags.slice(0, FLAG_DISPLAY_LIMIT), flagsTotal: out.flags.length, unknownStatuses: out.unknownStatuses,
  };
}

/** The sanitized rows travel to the confirm step as this payload. It holds only the five fields per row; the confirm step re-checks every value. */
export function serializePayload(rows: readonly ImportRow[], counts: Counts): string {
  return JSON.stringify({ v: 1, rows, counts });
}

const int = (v: unknown, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
export function parsePayload(raw: string): { ok: true; rows: ImportRow[]; counts: Counts } | { ok: false; error: string } {
  const bad = (m: string) => ({ ok: false as const, error: m });
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return bad("The import data was not readable. Choose the file again."); }
  const o = j as { v?: number; rows?: unknown; counts?: Record<string, unknown> };
  if (!o || o.v !== 1 || !Array.isArray(o.rows) || !o.counts) return bad("The import data was not readable. Choose the file again.");
  if (o.rows.length > LIMITS.importableRows) return bad("Too many rows.");
  const seen = new Set<string>(), rows: ImportRow[] = [];
  for (const r of o.rows as Record<string, unknown>[]) {
    if (typeof r?.external_id !== "string" || !/^(t:)?[A-Za-z0-9_-]{4,64}$/.test(r.external_id)) return bad("A payment id is not valid. Choose the file again.");
    if (typeof r.occurred_on !== "string" || parseDate(r.occurred_on) !== r.occurred_on) return bad("A date is not valid. Choose the file again.");
    const M = 99_999_999_999;
    if (!int(r.gross_cents, M) || !int(r.tip_cents, M) || !int(r.fee_cents, M)) return bad("An amount is not valid. Choose the file again.");
    if (r.gross_cents + r.tip_cents === 0 || r.fee_cents > r.gross_cents + r.tip_cents) return bad("An amount is not valid. Choose the file again.");
    if (seen.has(r.external_id)) return bad("A payment id is repeated. Choose the file again.");
    seen.add(r.external_id);
    rows.push({ external_id: r.external_id, occurred_on: r.occurred_on, gross_cents: r.gross_cents, tip_cents: r.tip_cents, fee_cents: r.fee_cents });
  }
  const c = o.counts, keys: (keyof Counts)[] = ["read", "importable", "duplicateInFile", "refund", "failed", "uncertain"];
  const counts = {} as Counts;
  for (const k of keys) { const v = c[k]; if (!int(v, 1_000_000)) return bad("The import counts are not valid. Choose the file again."); counts[k] = v; }
  return { ok: true, rows, counts };
}
