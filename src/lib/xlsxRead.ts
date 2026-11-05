import { inflateRawSync } from "node:zlib";

/*
 * A small, dependency-free reader for Excel .xlsx workbooks (and the CSV text we already read). Every sheet becomes a grid of
 * trimmed text cells, so the importers can treat Excel and CSV the same way. Nothing runs: formulas are read as their saved
 * result, macros, pictures and links are ignored. Cells styled as dates come out as YYYY-MM-DD (times as HH:MM:SS).
 * Limits guard against "zip bombs": each part may unpack to at most MAX_PART_BYTES.
 * The old binary .xls format is not supported; the caller is told to save as .xlsx or CSV.
 */
export interface Sheet { name: string; rows: string[][] }
export type ReadOutcome = { ok: true; sheets: Sheet[] } | { ok: false; error: string };

export const MAX_PART_BYTES = 25_000_000;
const MAX_SHEETS = 50, MAX_ROWS = 50_000, MAX_COLS = 200;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const dec = new TextDecoder("utf-8");

class Bad extends Error {}

/** Lists the zip's files and unpacks one on request. */
function openZip(b: Uint8Array): (name: string) => string | null {
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Bad("zip");
  const count = u16(b, end + 10), cdAt = u32(b, end + 16);
  if (count === 0xffff || cdAt === 0xffffffff || cdAt >= b.length) throw new Bad("zip");
  const entries = new Map<string, { method: number; size: number; at: number; flags: number }>();
  let p = cdAt;
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new Bad("zip");
    const flags = u16(b, p + 8), method = u16(b, p + 10), size = u32(b, p + 20), nameLen = u16(b, p + 28), extra = u16(b, p + 30), comment = u16(b, p + 32), at = u32(b, p + 42);
    entries.set(dec.decode(b.subarray(p + 46, p + 46 + nameLen)).replace(/^\//, ""), { method, size, at, flags });
    p += 46 + nameLen + extra + comment;
  }
  return (name) => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.flags & 1) throw new Bad("encrypted");
    if (e.at + 30 > b.length || u32(b, e.at) !== 0x04034b50) throw new Bad("zip");
    const start = e.at + 30 + u16(b, e.at + 26) + u16(b, e.at + 28), data = b.subarray(start, start + e.size);
    if (data.length !== e.size) throw new Bad("zip");
    let out: Uint8Array;
    if (e.method === 0) out = data;
    else if (e.method === 8) { try { out = inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES }); } catch { throw new Bad("size"); } }
    else throw new Bad("zip");
    if (out.length > MAX_PART_BYTES) throw new Bad("size");
    return dec.decode(out);
  };
}

const ENT: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
export function xmlText(s: string): string {
  return s
    .replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e]))
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}
const attrs = (s: string): Record<string, string> => {
  const o: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) o[m[1]] =xmlText(m[2] ?? m[3] ?? "");
  return o;
};
/** Every <t> text inside a fragment, skipping phonetic (rPh) runs. */
const texts = (frag: string) => [...frag.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, "").matchAll(/<(?:\w+:)?t(?:\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g)].map((m) => xmlText(m[1] ?? "")).join("");

/** Excel's built-in number formats that show dates or times. */
const BUILTIN_DATE = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const BUILTIN_TIME = new Set([18, 19, 20, 21, 32, 33, 45, 46, 47]);
type Kind = "date" | "time" | "datetime" | null;
export function formatKind(code: string): Kind {
  const c = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/[_*]./g, "").replace(/\[[^\]]*\]/g, "").toLowerCase();
  const date = /[dy]/.test(c) || (/m/.test(c) && !/[hs]/.test(c)), time = /[hs]/.test(c);
  return date && time ? "datetime" : date ? "date" : time ? "time" : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** An Excel serial number -> text. 1900 system (with Excel's 1900 leap-year quirk) or 1904 system. */
export function serialToText(v: number, kind: Exclude<Kind, null>, date1904 = false): string {
  const ms = Math.round(v * 86_400_000) + (date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30));
  const d = new Date(ms);
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, t = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return kind === "date" ? day : kind === "time" ? t : `${day} ${t}`;
}

/** Plain numbers lose binary noise (111.49999999999999 -> 111.5) so money columns read the way Excel shows them. */
function cleanNumber(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.abs(n) >= 1e15) return raw;
  return String(Math.round(n * 1e6) / 1e6);
}

function colIndex(ref: string): number {
  const m = /^([A-Z]{1,3})/.exec(ref);
  if (!m) return -1;
  let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const resolve = (base: string, target: string) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
  return parts.join("/");
};

export function readXlsx(bytes: Uint8Array): ReadOutcome {
  try {
    const get = openZip(bytes);
    const wb = get("xl/workbook.xml");
    if (wb === null) return { ok: false, error: "This file is not an Excel workbook (.xlsx)." };
    const rels = new Map<string, { type: string; target: string }>();
    for (const m of (get("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)) { const a = attrs(m[1]); rels.set(a.Id, { type: a.Type ?? "", target: resolve("xl/workbook.xml", a.Target ?? "") }); }
    const relOf = (suffix: string, fallback: string) => [...rels.values()].find((r) => r.type.endsWith(suffix))?.target ?? fallback;
    const date1904 = /<(?:\w+:)?workbookPr\b[^>]*date1904\s*=\s*["'](1|true)["']/.test(wb);

    const shared = [...(get(relOf("/sharedStrings", "xl/sharedStrings.xml")) ?? "").matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)].map((m) => texts(m[1] ?? ""));
    const styles = get(relOf("/styles", "xl/styles.xml")) ?? "";
    const custom = new Map<number, string>();
    for (const m of styles.matchAll(/<(?:\w+:)?numFmt\b([^>]*)\/?>/g)) { const a = attrs(m[1]); custom.set(Number(a.numFmtId), a.formatCode ?? ""); }
    const xfBlock = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(styles)?.[1] ?? "";
    const styleKind: Kind[] = [...xfBlock.matchAll(/<(?:\w+:)?xf\b([^>]*?)\/?>/g)].map((m) => {
      const id = Number(attrs(m[1]).numFmtId ?? 0);
      if (custom.has(id)) return formatKind(custom.get(id)!);
      return BUILTIN_DATE.has(id) ? (id === 22 ? "datetime" : "date") : BUILTIN_TIME.has(id) ? "time" : null;
    });

    const sheets: Sheet[] = [];
    for (const m of wb.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?>/g)) {
      if (sheets.length >= MAX_SHEETS) break;
      const a = attrs(m[1]), rel = rels.get(Object.entries(a).find(([k]) => /(^|:)id$/.test(k) && k !== "sheetId")?.[1] ?? "");
      const xml = rel ? get(rel.target) : null;
      if (xml === null) continue;
      const rows: string[][] = [];
      for (const r of xml.matchAll(/<(?:\w+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
        const cells: string[] = [];
        let next = 0;
        for (const c of (r[1] ?? "").matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
          const ca = attrs(c[1]), body = c[2] ?? "";
          const col = ca.r ? colIndex(ca.r) : next;
          next = col + 1;
          if (col < 0 || col >= MAX_COLS) continue;
          const v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body)?.[1];
          let text = "";
          switch (ca.t) {
            case "s": text = shared[Number(v)] ?? ""; break;
            case "inlineStr": text = texts(body); break;
            case "b": text = v === "1" ? "TRUE" : v === "0" ? "FALSE" : ""; break;
            case "e": text = ""; break;
            case "str": text = xmlText(v ?? ""); break;
            case "d": text = xmlText(v ?? "").slice(0, 10); break;
            default: {
              if (v === undefined) break;
              const kind = styleKind[Number(ca.s ?? 0)] ?? null, n = Number(v);
              text = kind && Number.isFinite(n) ? serialToText(n, kind, date1904) : cleanNumber(xmlText(v));
            }
          }
          while (cells.length < col) cells.push("");
          cells[col] = text.trim();
        }
        while (cells.length && cells[cells.length - 1] === "") cells.pop();
        if (cells.length === 0) continue;
        if (rows.length >= MAX_ROWS) return { ok: false, error: "That sheet has too many rows. Save a shorter range." };
        rows.push(cells);
      }
      sheets.push({ name: (a.name ?? `Sheet ${sheets.length + 1}`).slice(0, 40), rows });
    }
    if (sheets.length === 0) return { ok: false, error: "No sheets could be read in that workbook." };
    return { ok: true, sheets };
  } catch (e) {
    const why = e instanceof Bad ? e.message : "";
    if (why === "encrypted") return { ok: false, error: "That workbook is password-protected. Remove the password in Excel, then try again." };
    if (why === "size") return { ok: false, error: "That workbook unpacks to more than the size limit. Save a shorter range." };
    return { ok: false, error: "That Excel file could not be read. Open it in Excel and save it again as .xlsx (or CSV)." };
  }
}

/** Which kind of upload this is, from its first bytes (not just its name). */
export function sniff(bytes: Uint8Array, name: string): "xlsx" | "xls" | "csv" | "other" {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) return "xlsx";
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return "xls";
  if (/\.(csv|txt)$/i.test(name) || !bytes.subarray(0, 4096).some((b) => b === 0)) return "csv";
  return "other";
}
