const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const S = require("../.testbuild/squareImport.js"), F = require("../.testbuild/squareFormat.js");

// Synthetic data only: made-up IDs and amounts.
const HEAD = ["Date", "Time", "Time Zone", "Gross Sales", "Discounts", "Service Charges", "Net Sales", "Tax", "Tip", "Partial Refunds", "Total Collected", "Fees", "Net Total", "Transaction ID", "Payment ID", "Event Type", "Transaction Status", "Refund Reason"];
const line = (o) => {
  const base = { Date: "2026-10-01", Time: "09:00:00", "Time Zone": "Central", "Gross Sales": "$100.00", Discounts: "$0.00", "Service Charges": "$0.00", "Net Sales": "$100.00", Tax: "$0.00", Tip: "$15.00", "Partial Refunds": "$0.00", "Total Collected": "$115.00", Fees: "-$3.50", "Net Total": "$111.50", "Transaction ID": "TXN0001", "Payment ID": "PAY0001", "Event Type": "Payment", "Transaction Status": "Complete", "Refund Reason": "", ...o };
  return HEAD.map((h) => (/[",]/.test(base[h]) ? `"${base[h].replace(/"/g, '""')}"` : base[h])).join(",");
};
const csv = (...rows) => [HEAD.join(","), ...rows.map(line)].join("\r\n") + "\r\n";
const ok = (t) => { const r = S.parseSquareCsv(t); assert.equal(r.ok, true, r.error); return r; };

test("columns are found by name, in any order, with extra columns ignored", () => {
  const shuffled = [...HEAD].reverse().concat(["Customer Name", "Description"]);
  const rows = [{ Date: "2026-10-01", Tip: "$15.00", "Total Collected": "$115.00", Fees: "-$3.50", "Net Total": "$111.50", "Payment ID": "PAY0009", "Transaction Status": "Complete", Tax: "$0.00", "Customer Name": "SENTINEL_PERSON", Description: "SENTINEL_NOTE" }];
  const text = shuffled.join(",") + "\r\n" + shuffled.map((h) => rows[0][h] ?? "").join(",") + "\r\n";
  const r = ok(text);
  assert.equal(r.rows.length, 1); assert.equal(r.rows[0].external_id, "PAY0009");
  assert.deepEqual(S.parseSquareCsv("Date,Tip\r\n2026-10-01,5\r\n").ok, false);
  const miss = S.parseSquareCsv("Date,Tip\r\n"); assert.match(miss.error, /Missing column.*Total Collected.*squareFormat\.ts/);
  assert.equal(S.parseSquareCsv(HEAD.join(",") + ",Tip\r\n").ok, false, "a repeated header is refused");
});

test("money: revenue + tip = total collected; fee is positive; nothing double counted", () => {
  const r = ok(csv({}));
  const row = r.rows[0];
  assert.deepEqual([row.gross_cents, row.tip_cents, row.fee_cents], [10000, 1500, 350]);
  assert.equal(row.gross_cents + row.tip_cents, 11500, "equals Total Collected");
  const p = S.buildPreview(r, new Set());
  assert.deepEqual([p.revenue, p.tips, p.fees, p.netAfterFees], [10000, 1500, 350, 11150]);
  assert.equal(ok(csv({ Fees: "3.50" })).rows[0].fee_cents, 350, "positive fee notation also works");
  assert.equal(ok(csv({ Tip: "", "Total Collected": "$100.00", Fees: "$3.50", "Net Total": "$96.50" })).rows[0].tip_cents, 0);
});

test("refunds, failed and unclear rows are flagged and never counted", () => {
  const r = ok(csv(
    { "Payment ID": "PAY1001", "Event Type": "Refund" },
    { "Payment ID": "PAY1002", "Transaction Status": "Refunded" },
    { "Payment ID": "PAY1003", "Partial Refunds": "$10.00" },
    { "Payment ID": "PAY1004", "Total Collected": "-$115.00", "Net Total": "-$111.50" },
    { "Payment ID": "PAY1005", "Refund Reason": "SENTINEL_REASON" },
    { "Payment ID": "PAY1006", "Transaction Status": "Declined" },
    { "Payment ID": "PAY1007", "Transaction Status": "Canceled" },
    { "Payment ID": "PAY1008", "Transaction Status": "Pending" },
    { "Payment ID": "PAY1009", "Event Type": "Deposit" },
    { "Payment ID": "PAY1010", Tax: "$8.00" },
    { "Payment ID": "", "Transaction ID": "" },
    { "Payment ID": "PAY1012", "Net Total": "$999.00" },
    { "Payment ID": "PAY1013", Fees: "-$500.00", "Net Total": "-$385.00" },
    { "Payment ID": "PAY1014", Date: "not a date" },
    { "Payment ID": "PAY1015", "Total Collected": "abc" },
    { "Payment ID": "PAY1016" },
  ));
  assert.equal(r.counts.read, 16);
  assert.equal(r.counts.refund, 5); assert.equal(r.counts.failed, 2);
  assert.equal(r.counts.uncertain, 8); assert.equal(r.rows.length, 1); assert.equal(r.rows[0].external_id, "PAY1016");
  assert.equal(r.flags.length, 15); assert.deepEqual(r.flags.slice(0, 2).map((f) => [f.row, f.category]), [[2, "refund"], [3, "refund"]]);
  assert.deepEqual(r.unknownStatuses, ["Pending"]);
});

test("duplicates: same file twice, repeated rows, overlap with earlier imports", () => {
  const r = ok(csv({ "Payment ID": "PAY2001" }, { "Payment ID": "PAY2001" }, { "Payment ID": "PAY2002" }, { "Payment ID": "", "Transaction ID": "TXN3001" }));
  assert.equal(r.rows.length, 3); assert.equal(r.counts.duplicateInFile, 1);
  assert.deepEqual(r.rows.map((x) => x.external_id), ["PAY2001", "PAY2002", "t:TXN3001"], "payment id preferred, transaction id as a fallback");
  const p = S.buildPreview(r, new Set(["PAY2001", "t:TXN3001"]));
  assert.deepEqual([p.newCount, p.alreadyImported], [1, 2]); assert.equal(p.revenue, 10000);
  const again = S.buildPreview(r, new Set(r.rows.map((x) => x.external_id)));
  assert.equal(again.newCount, 0, "re-importing the same file adds nothing");
});

test("privacy: nothing outside the allowed columns survives, and nothing from refund rows", () => {
  const extra = HEAD.concat(["Customer Name", "Description", "Card Brand", "PAN Suffix", "Staff Name", "Details", "Notes"]);
  const mk = (o) => extra.map((h) => (/^(Customer Name|Description|Card Brand|PAN Suffix|Staff Name|Details|Notes)$/.test(h) ? "SENTINEL_" + h.replace(/\W/g, "") : line({ "Payment ID": "PAY4001", ...o }).split(",")[HEAD.indexOf(h)] ?? "")).join(",");
  const text = extra.join(",") + "\r\n" + mk({}) + "\r\n" + mk({ "Payment ID": "PAY4002", "Event Type": "Refund", "Refund Reason": "SENTINEL_REASONTEXT" }) + "\r\n" + mk({ "Payment ID": "PAY4003", "Transaction Status": "SENTINEL_STATUS 123 !!!" }) + "\r\n";
  const r = ok(text);
  const dump = JSON.stringify(r) + S.serializePayload(r.rows, r.counts) + JSON.stringify(S.buildPreview(r, new Set()));
  assert.doesNotMatch(dump, /SENTINEL/, "no excluded text anywhere in results, preview or payload");
  assert.deepEqual(Object.keys(r.rows[0]).sort(), ["external_id", "fee_cents", "gross_cents", "occurred_on", "tip_cents"]);
  for (const f of r.flags) { assert.deepEqual(Object.keys(f).sort(), ["category", "reason", "row"]); assert.ok(["refund", "failed", "uncertain"].includes(f.category)); }
  assert.deepEqual(r.unknownStatuses, ["(unreadable)"], "an odd status value is not echoed");
  // the parser only ever names the allowed fields
  assert.deepEqual(Object.keys(F.SQUARE_COLUMNS).sort(), ["date", "eventType", "fees", "netTotal", "partialRefunds", "paymentId", "refundReason", "status", "tax", "tip", "totalCollected", "transactionId"]);
  const src = fs.readFileSync(path.join(__dirname, "../src/lib/squareImport.ts"), "utf8");
  assert.doesNotMatch(src, /\bfetch\(|node:fs|child_process|localStorage|console\./, "no network, files or logging");
  assert.doesNotMatch(src, /"Total Collected"|"Payment ID"|"Transaction Status"/, "header names live only in squareFormat.ts");
});

test("file format details: BOM, quotes, US dates, unclosed quote, empty", () => {
  const r = ok("﻿" + csv({ Date: "10/05/2026", "Payment ID": "PAY5001" }).replace("PAY5001", "PAY5001"));
  assert.equal(r.rows[0].occurred_on, "2026-10-05");
  assert.equal(ok(csv({ "Refund Reason": '"quoted, with comma"' }).replace('"""quoted, with comma"""', '""')).counts.read, 1);
  assert.match(S.parseSquareCsv(HEAD.join(",") + '\r\n"2026-10-01,unclosed').error, /unclosed/);
  assert.match(S.parseSquareCsv("").error, /empty/);
  assert.equal(S.parseSquareCsv("x".repeat(F.LIMITS.fileBytes + 1)).ok, false);
});

test("confirm step re-checks everything it is given", () => {
  const good = ok(csv({}, { "Payment ID": "PAY6002" }));
  const pay = S.serializePayload(good.rows, good.counts);
  assert.equal(S.parsePayload(pay).ok, true);
  const tamper = (fn) => { const o = JSON.parse(pay); fn(o); return S.parsePayload(JSON.stringify(o)).ok; };
  assert.equal(tamper((o) => (o.rows[0].gross_cents = -1)), false);
  assert.equal(tamper((o) => (o.rows[0].fee_cents = 10 ** 9)), false);
  assert.equal(tamper((o) => (o.rows[0].external_id = "x'; DROP TABLE")), false);
  assert.equal(tamper((o) => (o.rows[0].occurred_on = "2026-13-40")), false);
  assert.equal(tamper((o) => (o.rows[1].external_id = o.rows[0].external_id)), false);
  assert.equal(tamper((o) => (o.counts.read = -1)), false);
  assert.equal(tamper((o) => (o.rows[0].customer = "x")), true, "unknown keys are dropped, not stored");
  assert.equal(S.parsePayload("{not json").ok, false);
  assert.deepEqual(Object.keys(S.parsePayload(JSON.stringify({ ...JSON.parse(pay), rows: [{ ...JSON.parse(pay).rows[0], customer: "X" }] })).rows[0]).sort(), ["external_id", "fee_cents", "gross_cents", "occurred_on", "tip_cents"]);
});

test("quoted cells with commas, quotes and line breaks in ignored columns do not shift anything", () => {
  const h = HEAD.concat(["Description"]).join(",");
  const cells = line({ "Payment ID": "PAY7001" }) + `,"line one, with comma and ""quote""\nline two"`;
  const r = ok(h + "\r\n" + cells + "\r\n" + line({ "Payment ID": "PAY7002" }) + ",plain\r\n");
  assert.equal(r.counts.read, 2); assert.deepEqual(r.rows.map((x) => x.external_id), ["PAY7001", "PAY7002"]);
});

test("sales tax: a row with tax is flagged and never counted, so revenue + tip always equals total collected", () => {
  const taxed = { "Payment ID": "PAY8001", Tax: "$8.25", "Total Collected": "$123.25", "Net Total": "$119.75" }; // 100.00 + 15.00 tip + 8.25 tax - 3.50 fee
  const r = ok(csv(taxed, { "Payment ID": "PAY8002" }, { "Payment ID": "PAY8003", "Total Collected": "$80.00", Tip: "$0.00", Fees: "-$2.62", "Net Total": "$77.38" }));
  assert.equal(r.rows.length, 2); assert.equal(r.counts.uncertain, 1);
  assert.deepEqual(r.flags, [{ row: 2, category: "uncertain", reason: "has sales tax (none expected)" }]);
  assert.ok(!r.rows.some((x) => x.external_id === "PAY8001"), "the taxed row adds nothing, neither tax nor revenue");
  const collected = 11500 + 8000;
  const p = S.buildPreview(r, new Set());
  assert.equal(p.revenue + p.tips, collected, "revenue + tips equals total collected over the imported rows");
  assert.deepEqual([p.revenue, p.tips, p.fees, p.netAfterFees], [18000, 1500, 612, 18888]);
  for (const x of r.rows) assert.ok(x.gross_cents >= 0 && x.fee_cents <= x.gross_cents + x.tip_cents);
});
