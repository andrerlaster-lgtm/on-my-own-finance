/**
 * CSV for exports. Every cell is quoted when needed, and a cell that starts with = + - @ (or a tab / carriage return) gets a
 * leading apostrophe so a spreadsheet never runs it as a formula (CSV injection). Pure: no network, no files.
 */
export type Cell = string | number | boolean | null | undefined | Date;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v !== "number") s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: readonly string[], rows: readonly Record<string, Cell>[]): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}
