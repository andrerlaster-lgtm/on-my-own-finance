const test = require("node:test"), assert = require("node:assert/strict");
const zlib = require("node:zlib");
const X = require("../.testbuild/xlsxRead.js"), E = require("../.testbuild/expenseImport.js"), S = require("../.testbuild/squareImport.js");
const W = require("../.testbuild/xlsx.js"), Sch = require("../.testbuild/schema.js");

// Synthetic data only. Builds a tiny .xlsx in memory: shared strings, inline strings, date styles, and both zip methods.
const enc = (s) => new TextEncoder().encode(s);
function zipDeflate(files) {
  const parts = [], central = []; let offset = 0;
  const u16 = (v) => [v & 0xff, (v >> 8) & 0xff], u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const f of files) {
    const name = enc(f.name), comp = new Uint8Array(zlib.deflateRawSync(f.data)), crc = W.crc32(f.data);
    const local = Uint8Array.from([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(8), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(comp.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...name]);
    parts.push(local, comp);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(8), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(comp.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]));
    offset += local.length + comp.length;
  }
  const cd = central.reduce((t, c) => t + c.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cd), ...u32(offset), ...u16(0)]);
  return Buffer.concat([...parts, ...central, end]);
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
/** sheets: [{ name, rows: [[cell...]] }]; a cell is a string (shared), { n, s } (number with style), { inline } or null. */
function workbook(sheets, { deflate = false } = {}) {
  const strings = [], sid = (s) => { let i = strings.indexOf(s); if (i < 0) { i = strings.length; strings.push(s); } return i; };
  const col = (i) => String.fromCharCode(65 + i);
  const sheetXml = (rows) => `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => {
    const ref = `${col(ci)}${ri + 1}`;
    if (c === null || c === undefined) return "";
    if (typeof c === "string") return `<c r="${ref}" t="s"><v>${sid(c)}</v></c>`;
    if (c.inline !== undefined) return `<c r="${ref}" t="inlineStr"><is><t>${esc(c.inline)}</t></is></c>`;
    return `<c r="${ref}"${c.s ? ` s="${c.s}"` : ""}>${c.f ? `<f>${c.f}</f>` : ""}<v>${c.n}</v></c>`;
  }).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const files = [
    { name: "xl/workbook.xml", data: enc(`<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: enc(`<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    // style 0 general, 1 custom m/d/yyyy date, 2 money "$"#,##0.00, 3 built-in 14 (date)
    { name: "xl/styles.xml", data: enc(`<styleSheet><numFmts count="2"><numFmt numFmtId="164" formatCode="m/d/yyyy"/><numFmt numFmtId="166" formatCode="&quot;$&quot;#,##0.00"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="166"/><xf numFmtId="14"/></cellXfs></styleSheet>`) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc(sheetXml(s.rows)) })),
  ];
  files.push({ name: "xl/sharedStrings.xml", data: enc(`<sst>${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`) });
  return deflate ? zipDeflate(files) : Buffer.from(W.zipStored(files));
}
const D = (iso) => (Date.UTC(...iso.split("-").map((v, i) => (i === 1 ? v - 1 : +v))) - Date.UTC(1899, 11, 30)) / 86400000; // ISO -> Excel serial

test("reads shared and inline strings, dates, money and gaps, from stored and deflated zips", () => {
  for (const deflate of [false, true]) {
    const book = workbook([{ name: "2026", rows: [["Date", "Category", "Amount ($)"], [{ n: D("2026-03-04"), s: 1 }, "Supplies", { n: "111.49999999999999", s: 2 }], [{ n: D("2026-12-31"), s: 3 }, null, { inline: "$5.00" }]] }], { deflate });
    assert.equal(X.sniff(book, "x.xlsx"), "xlsx");
    const r = X.readXlsx(book);
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.sheets[0].rows, [["Date", "Category", "Amount ($)"], ["2026-03-04", "Supplies", "111.5"], ["2026-12-31", "", "$5.00"]]);
    assert.equal(r.sheets[0].name, "2026");
  }
});

test("date formats are told apart from money formats; bad files get plain messages", () => {
  assert.equal(X.formatKind("m/d/yyyy"), "date");
  assert.equal(X.formatKind('"$"#,##0.00'), null);
  assert.equal(X.formatKind("[$-409]h:mm AM/PM"), "time");
  assert.equal(X.formatKind("0.00_);[Red](0.00)"), null);
  assert.equal(X.serialToText(D("2025-07-14") + 0.5, "datetime"), "2025-07-14 12:00:00");
  assert.equal(X.sniff(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]), "old.xls"), "xls");
  assert.equal(X.readXlsx(enc("not a zip")).ok, false);
  assert.match(X.readXlsx(Buffer.from(W.zipStored([{ name: "a.txt", data: enc("hi") }]))).error, /not an Excel workbook/);
});

test("Square Transactions export saved as Excel imports the same as the CSV", () => {
  const head = ["Date", "Tax", "Tip", "Total Collected", "Fees", "Net Total", "Payment ID", "Transaction Status", "Customer Name"];
  const book = workbook([{ name: "Transactions", rows: [head, [{ n: D("2026-10-01"), s: 1 }, { n: 0 }, { n: 15 }, { n: 115 }, { n: -3.5 }, { n: 111.5 }, "PAY0001", "Complete", "SENTINEL_PERSON"]] }]);
  const r = X.readXlsx(book), out = S.parseSquareRecords(r.sheets[0].rows);
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(out.rows, [{ external_id: "PAY0001", occurred_on: "2026-10-01", gross_cents: 10000, tip_cents: 1500, fee_cents: 350 }]);
  assert.doesNotMatch(JSON.stringify(out), /SENTINEL/);
});

test("Square's Item details and Sales summary files get a message naming the right export", () => {
  assert.match(S.parseSquareCsv("Date,Time,Category,Item,Qty,Gross Sales,Transaction ID,Payment ID,Customer Name\r\n").error, /Item details.*Transactions CSV/);
  assert.match(S.otherSquareExport([["Sales summary - Summary\nAll day", "x"]]), /Sales summary.*Transactions/);
  assert.equal(S.otherSquareExport([["Date", "Amount"]]), null);
});

const expenseBook = () => X.readXlsx(workbook([
  { name: "2025", rows: [["Date", "Category", "Description", "Amount ($)", "with tax", "Tax"],
    [{ n: D("2025-02-03"), s: 1 }, "Supplies", "Tubes", { n: 20, s: 2 }],
    [{ n: D("2025-02-03"), s: 1 }, "supplies", "Tubes again", { n: 20, s: 2 }],
    [{ n: D("2025-03-01"), s: 1 }, null, "Monthly bank fee", { n: 12, s: 2 }, { n: 12.99 }],
    [{ inline: "4/5/25" }, "Donation", "x", { n: 50 }],
    [null, null, null, { n: 102, f: "SUM(D2:D5)" }],
    [{ n: D("2025-06-01"), s: 1 }, "Marketing", "Cards", { n: 0 }]] },
  { name: "2026", rows: [["k", "Category", "Description", "Amount ($)"], [{ n: D("2026-01-02"), s: 1 }, null, "Needles", { n: 9.5 }]] },
  { name: "Copy", rows: [] },
])).sheets;

test("expense sheets: amounts, dates, groups, suggestions and skipped total lines", () => {
  const r = E.parseExpenseSheets(expenseBook());
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.rows.map((x) => [x.spent_on, x.amount_cents]), [["2025-02-03", 2000], ["2025-02-03", 2000], ["2025-03-01", 1299], ["2025-04-05", 5000], ["2026-01-02", 950]]);
  assert.equal(r.withTaxUsed, 1, "the 'with tax' amount is used when filled in");
  assert.deepEqual(r.rows.map((x) => x.key), ["x1:2025-02-03|2000|1", "x1:2025-02-03|2000|2", "x1:2025-03-01|1299|1", "x1:2025-04-05|5000|1", "x1:2026-01-02|950|1"]);
  assert.equal(r.rows[0].group, r.rows[1].group, "Supplies and supplies are one group");
  const g = Object.fromEntries(r.groups.map((x) => [x.label, x.guess]));
  assert.deepEqual(g, { Supplies: "supplies", "No category: Monthly bank fee": "licenses_fees", Donation: "skip", "No category: Needles": "supplies" });
  assert.deepEqual(r.flags.map((f) => [f.sheet, f.row, f.reason]), [["2025", 6, "no date (a total line?)"], ["2025", 7, "amount is zero or negative"]]);
  assert.deepEqual(r.sheets.map((s) => [s.name, s.rows, s.usable]), [["2025", 4, true], ["2026", 1, true], ["Copy", 0, false]]);
  assert.equal(r.sheets[1].total, 950, "a sheet whose date column isn't headed Date still finds its dates");
  assert.doesNotMatch(E.serializeExpensePayload(r.rows, r.groups.length, r.sheets.length), /Tubes|Needles|bank/i, "descriptions never reach the saved payload");
});

test("expense payload round-trips and refuses tampering", () => {
  const r = E.parseExpenseSheets(expenseBook());
  const raw = E.serializeExpensePayload(r.rows, r.groups.length, r.sheets.length), back = E.parseExpensePayload(raw);
  assert.equal(back.ok, true);
  assert.deepEqual(back.rows.map((x) => x.key), r.rows.map((x) => x.key));
  const j = JSON.parse(raw);
  for (const bad of [(o) => (o.rows[0][2] = -5), (o) => (o.rows[0][4] = "x1:2025-02-03|9999|1"), (o) => (o.rows[1] = o.rows[0]), (o) => (o.rows[0][3] = 99), (o) => (o.rows[0][5] = "a@b.com"), (o) => (o.v = 2)]) {
    const c = JSON.parse(JSON.stringify(j)); bad(c);
    assert.equal(E.parseExpensePayload(JSON.stringify(c)).ok, false);
  }
});

test("import plan: sheet and category choices, already imported, and hand-entered matches", () => {
  const r = E.parseExpenseSheets(expenseBook());
  const map = new Map(r.groups.map((g, i) => [i, g.guess]));
  const p = E.planExpenseImport(r.rows, { sheets: new Set([0, 1]), map, skipMatches: true, alreadyImported: new Set(["x1:2026-01-02|950|1"]), handEntered: new Map([["2025-02-03|2000", 1]]) });
  assert.equal(p.notChosen, 1, "the donation group is left out");
  assert.equal(p.alreadyImported, 1);
  assert.equal(p.matchedHandEntered, 1, "only one of the two equal rows matches the one hand-entered expense");
  assert.deepEqual(p.add.map((x) => [x.key, x.category]), [["x1:2025-02-03|2000|2", "supplies"], ["x1:2025-03-01|1299|1", "licenses_fees"]]);
  const none = E.planExpenseImport(r.rows, { sheets: new Set(), map, skipMatches: false, alreadyImported: new Set(), handEntered: new Map() });
  assert.equal(none.add.length, 0);
});

test("CSV expense lists work too; files without an Amount column are refused", () => {
  const rows = [...S.csvRecords("Date,Vendor,Category,Amount\r\n2026-05-01,Acme Labs,Insurance,$80.00\r\n")];
  assert.equal(E.looksLikeExpenses([{ name: "CSV", rows }]), true);
  const r = E.parseExpenseSheets([{ name: "CSV", rows }]);
  assert.deepEqual([r.rows[0].amount_cents, r.rows[0].vendor, r.groups[0].guess, r.groups[0].guessed], [8000, "Acme Labs", "insurance", false]);
  assert.equal(E.parseExpenseSheets([{ name: "x", rows: [["Date", "Note"]] }]).ok, false);
  assert.equal(E.looksLikeExpenses([{ name: "sq", rows: [["Date", "Amount", "Total Collected"]] }]), false, "a Square file is never read as expenses");
});

test("version 12 adds only an optional import key column with a unique index", () => {
  assert.ok(Sch.SCHEMA_VERSION >= 12);
  const all = Sch.schemaStatements.join("\n");
  assert.match(all, /ALTER TABLE expenses ADD COLUMN IF NOT EXISTS import_key text/);
  assert.match(all, /CREATE UNIQUE INDEX IF NOT EXISTS expenses_import_key_uq ON expenses \(import_key\) WHERE import_key IS NOT NULL/);
});
