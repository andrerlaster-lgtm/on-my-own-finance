import { fmtAmount, fmtPercent, type ReportDoc } from "./statements";

/* A small, dependency-free PDF writer for statements: Helvetica labels, Courier figures (fixed width, so columns line up), letter size. */
const ascii = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7e]/g, "?");
const pdfStr = (s: string) => ascii(s).replace(/([\\()])/g, "\\$1");

export function reportToPdf(doc: ReportDoc, generated: string): Uint8Array {
  const cols = Math.max(1, doc.columns.length);
  const landscape = cols > 4;
  const W = landscape ? 792 : 612, H = landscape ? 612 : 792, M = 40, LH = 13;
  const numW = cols > 1 ? Math.min(92, Math.floor((W - 2 * M - 180) / (cols - 1))) : 0;
  const labelW = W - 2 * M - numW * (cols - 1);
  const labelChars = Math.floor(labelW / 5.2);
  const pages: string[][] = [[]];
  let y = H - M;
  const cur = () => pages[pages.length - 1];
  const text = (x: number, yy: number, s: string, font: "F1" | "F2" | "F3", size = 9) => cur().push(`BT /${font} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${pdfStr(s)}) Tj ET`);
  const rightText = (xr: number, yy: number, s: string, font: "F2" | "F3", size = 9) => text(xr - ascii(s).length * size * 0.6, yy, s, font, size);
  const need = (n: number) => { if (y - n < M + 20) { pages.push([]); y = H - M; } };
  const rule = (yy: number) => cur().push(`0.5 w ${M} ${yy.toFixed(1)} m ${W - M} ${yy.toFixed(1)} l S`);
  text(M, y, doc.title, "F2", 15); y -= 18;
  if (doc.subtitle) { text(M, y, doc.subtitle, "F1", 10); y -= 14; }
  if (doc.basis) { text(M, y, doc.basis, "F1", 9); y -= 14; }
  y -= 4;
  if (doc.blocked) {
    for (const line of ascii(doc.blocked).match(/.{1,95}(\s|$)/g) ?? []) { need(LH); text(M, y, line.trim(), "F1", 10); y -= LH; }
  } else {
    doc.columns.forEach((c, i) => (i === 0 ? text(M, y, c.label, "F2") : rightText(M + labelW + numW * i, y, c.label.slice(0, Math.floor(numW / 5.4)), "F2", 8)));
    y -= 4; rule(y); y -= LH;
    for (const row of doc.rows) {
      need(LH + 4);
      if (row.kind === "blank") { y -= 6; continue; }
      const bold = row.kind === "section" || row.kind === "subtotal" || row.kind === "total";
      if (row.kind === "total") { rule(y + LH - 3); }
      row.cells.forEach((c, i) => {
        const s = c.miles !== undefined ? (c.miles / 10).toFixed(1) : c.amount !== undefined ? fmtAmount(c.amount) : c.percent !== undefined ? fmtPercent(c.percent) : c.text;
        if (i === 0) text(M + (row.indent ?? 0) * 12, y, s.slice(0, labelChars - (row.indent ?? 0) * 2), bold || c.bold ? "F2" : "F1");
        else rightText(M + labelW + numW * i, y, s.slice(0, Math.floor(numW / 5.4)), "F3");
      });
      y -= LH;
    }
  }
  if (doc.notes.length) { y -= 6; for (const n of doc.notes) for (const line of ascii(n).match(/.{1,110}(\s|$)/g) ?? []) { need(LH); text(M, y, line.trim(), "F1", 8); y -= 11; } }
  pages.forEach((p, i) => { p.push(`BT /F1 7 Tf ${M} 24 Td (${pdfStr(`Generated ${generated}. Page ${i + 1} of ${pages.length}.`)}) Tj ET`); });

  const objs: string[] = [];
  const add = (body: string) => { objs.push(body); return objs.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(`<< /Type /Pages /Kids [${pages.map((_, i) => `${6 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  pages.forEach((p, i) => {
    const stream = p.join("\n");
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${7 + i * 2} 0 R >>`);
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n"; const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}
