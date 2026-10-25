const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const A = require("../.testbuild/activity.js");
const root = path.join(__dirname, "..");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const rd = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("activity lines show only safe facts, in plain words", () => {
  const d = A.describeActivity("add_expense", { id: 7, category: "supplies", amount_cents: 2499, vendor: "SHOULD NOT SHOW", note: "SECRET", email: "a@b.c" });
  assert.equal(d.label, "Added an expense"); assert.equal(d.facts, "id 7 · category supplies · amount $24.99");
  assert.doesNotMatch(JSON.stringify(d), /SHOULD NOT SHOW|SECRET|a@b\.c/);
  assert.equal(A.describeActivity("signin_refused", {}).label, "Sign-in refused");
  assert.equal(A.describeActivity("something_new", '{"id":3}').facts, "id 3"); assert.equal(A.describeActivity("x", "not json").facts, "");
  assert.doesNotMatch(A.describeActivity("add_movement", { kind: "<script>alert(1)</script>" }).facts, /script/, "odd text is not echoed");
});

test("every form button uses the double-tap-proof button, and error pages never print the error", () => {
  for (const f of walk(path.join(root, "src/app")).filter((x) => x.endsWith(".tsx"))) {
    const s = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(s, /<button className="(btn|btn secondary|linkbtn)" type="submit">/, `${path.relative(root, f)} has a plain submit button`);
  }
  for (const f of ["src/app/error.tsx", "src/app/global-error.tsx"]) assert.doesNotMatch(rd(f), /error\.message|\.stack|digest\}/, f);
  assert.match(rd("src/components/SubmitButton.tsx"), /useFormStatus/); assert.match(rd("src/components/SubmitButton.tsx"), /disabled=\{pending\}/);
});

test("an expense and its first photo save in one statement; whole-year lists are never silently cut short", () => {
  const db = rd("src/lib/db.ts");
  const add = db.slice(db.indexOf("export async function addExpense"), db.indexOf("export async function deleteExpense"));
  assert.match(add, /WITH e AS \(INSERT INTO expenses/); assert.match(add, /INSERT INTO expense_receipts/); assert.doesNotMatch(add, /addReceipt/);
  assert.match(db, /Too many \$\{what\} rows/);
  for (const f of ["src/app/page.tsx", "src/app/expenses/page.tsx", "src/app/mileage/page.tsx"]) assert.doesNotMatch(rd(f), /listIncome\(|listExpenses\(|listTrips\(/, `${f} uses the capped lists`);
});

test("phone use: big tap targets, labelled file input, lists draw a limited number of rows, big downloads are refused cleanly", () => {
  const css = rd("src/app/globals.css");
  assert.match(css, /input\[type=number\], input\[type=text\], input\[type=date\], select \{ min-height: ?44px; \}/); assert.match(css, /\.linkbtn \{ min-height: ?44px/); assert.match(css, /\.btn \{[^}]*min-height: ?44px/);
  assert.match(rd("src/components/ImportForm.tsx"), /type="file"[^>]*aria-label=/);
  const P = require("../.testbuild/paging.js");
  assert.deepEqual([P.rowsToShow(undefined), P.rowsToShow("300"), P.rowsToShow("999999"), P.rowsToShow("abc"), P.rowsToShow("5")], [100, 300, 100, 100, 20]);
  const ex = rd("src/app/api/export/route.ts"); assert.match(ex, /MAX_WEB_BYTES/); assert.match(ex, /status: 413/); assert.match(ex, /npm run backup/);
  for (const f of ["src/app/expenses/page.tsx", "src/app/mileage/page.tsx", "src/app/income/page.tsx"]) assert.match(rd(f), /rowsToShow/, f);
  assert.match(rd("src/app/expenses/page.tsx"), /receiptIdsFor/, "photo ids are fetched in one query, not one per row");
});
