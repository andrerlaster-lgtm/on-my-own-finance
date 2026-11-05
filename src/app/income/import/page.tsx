import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, existingExpenseImportKeys, existingSquareIds, handEnteredExpensePairs, importExpenseRows, importSquareRows } from "@/lib/db";
import { buildPreview, csvRecords, otherSquareExport, parsePayload, parseSquareRecords, serializePayload } from "@/lib/squareImport";
import { isCategory, looksLikeExpenses, parseExpensePayload, parseExpenseSheets, planExpenseImport, serializeExpensePayload } from "@/lib/expenseImport";
import { readXlsx, sniff, type Sheet } from "@/lib/xlsxRead";
import { LIMITS } from "@/lib/squareFormat";
import type { Category } from "@/lib/expenses";
import { ImportForm, type PreviewState } from "@/components/ImportForm";

export const dynamic = "force-dynamic";

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const isSquareHeader = (row: readonly string[] | undefined) => { const n = (row ?? []).map(norm); return n.includes("total collected") && (n.includes("payment id") || n.includes("transaction id")); };

async function previewAction(_prev: PreviewState, fd: FormData): Promise<PreviewState> {
  "use server";
  await requireOwner();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV or Excel file." };
  if (file.size > LIMITS.fileBytes) return { error: "That file is too large (2 MB limit). Export a shorter date range." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  let sheets: Sheet[];
  switch (sniff(bytes, file.name)) {
    case "xlsx": { const r = readXlsx(bytes); if (!r.ok) return { error: r.error }; sheets = r.sheets; break; }
    case "xls": return { error: "That is the old Excel format (.xls). Open it in Excel and save it as .xlsx (Excel Workbook) or CSV, then try again." };
    case "csv": {
      try { sheets = [{ name: "CSV file", rows: [...csvRecords(new TextDecoder("utf-8").decode(bytes))] }]; }
      catch { return { error: "The file has an unclosed quotation mark, so it can't be read." }; }
      break;
    }
    default: return { error: "Only CSV and Excel (.xlsx) files can be imported." };
  }

  const square = sheets.find((s) => isSquareHeader(s.rows[0]));
  if (square) {
    const out = parseSquareRecords(square.rows);
    if (!out.ok) return { error: out.error };
    const existing = await existingSquareIds(out.rows.map((r) => r.external_id));
    return { kind: "square", preview: buildPreview(out, existing), payload: serializePayload(out.rows, out.counts) };
  }
  const other = otherSquareExport(sheets[0]?.rows.slice(0, 1) ?? []);
  if (other) return { error: other };
  if (!looksLikeExpenses(sheets)) return { error: "This file wasn't recognized. The app can import Square's Transactions export (CSV or Excel), and expense lists (CSV or Excel) whose first row names the columns, with at least Date and Amount." };

  const out = parseExpenseSheets(sheets);
  if (!out.ok) return { error: out.error };
  const dates = out.rows.map((r) => r.spent_on).sort();
  const already = await existingExpenseImportKeys(out.rows.map((r) => r.key));
  const hand = dates.length ? await handEnteredExpensePairs(dates[0], dates[dates.length - 1]) : new Map<string, number>();
  const plan = planExpenseImport(out.rows, { sheets: new Set(out.sheets.map((_, i) => i)), map: new Map(out.groups.map((g, i) => [i, g.guess])), skipMatches: true, alreadyImported: already, handEntered: hand });
  return {
    kind: "expenses",
    expenses: { sheets: out.sheets, groups: out.groups, flags: out.flags, flagsTotal: out.flagsTotal, withTaxUsed: out.withTaxUsed, alreadyImported: plan.alreadyImported, handMatches: plan.matchedHandEntered },
    payload: serializeExpensePayload(out.rows, out.groups.length, out.sheets.length),
  };
}

async function confirmAction(fd: FormData) {
  "use server";
  await requireOwner();
  const parsed = parsePayload(String(fd.get("payload") ?? ""));
  if (!parsed.ok) redirect(`/income/import?error=${encodeURIComponent(parsed.error)}`);
  const r = await importSquareRows(parsed.rows, parsed.counts, fd.get("count_visits") === "on" ? 1 : 0);
  redirect(`/income/import?added=${r.added}&dupes=${r.duplicates}`);
}

async function confirmExpensesAction(fd: FormData) {
  "use server";
  await requireOwner();
  const parsed = parseExpensePayload(String(fd.get("payload") ?? ""));
  if (!parsed.ok) redirect(`/income/import?error=${encodeURIComponent(parsed.error)}`);
  const sheets = new Set<number>(), map = new Map<number, Category | "skip">();
  for (let i = 0; i < parsed.sheetCount; i++) if (fd.get(`sheet_${i}`) === "on") sheets.add(i);
  for (let g = 0; g < parsed.groupCount; g++) { const v = String(fd.get(`map_${g}`) ?? ""); if (v === "skip" || isCategory(v)) map.set(g, v); }
  const dates = parsed.rows.map((r) => r.spent_on).sort();
  const already = await existingExpenseImportKeys(parsed.rows.map((r) => r.key));
  const hand = dates.length ? await handEnteredExpensePairs(dates[0], dates[dates.length - 1]) : new Map<string, number>();
  const plan = planExpenseImport(parsed.rows, { sheets, map, skipMatches: fd.get("skip_matches") === "on", alreadyImported: already, handEntered: hand });
  const added = await importExpenseRows(plan.add.map((r) => ({ spent_on: r.spent_on, amount_cents: r.amount_cents, category: r.category, vendor: r.vendor, key: r.key })));
  redirect(`/income/import?exp_added=${added}&exp_existing=${plan.alreadyImported + plan.add.length - added}&exp_matched=${plan.matchedHandEntered}&exp_left=${plan.notChosen}`);
}

const n = (v: string | undefined) => (/^\d{1,6}$/.test(v ?? "") ? Number(v) : null);
const s = (k: number | null) => (k === 1 ? "" : "s");

export default async function ImportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const sp = await searchParams;
  const added = n(sp.added), dupes = n(sp.dupes);
  const ea = n(sp.exp_added), ee = n(sp.exp_existing), em = n(sp.exp_matched), el = n(sp.exp_left);
  return (
    <main>
      <p><Link href="/income">← Income</Link></p>
      <h1>Import a file</h1>
      <div className="note">
        Choose a CSV or Excel (.xlsx) file. The app works out what it is:
        <ul className="plain">
          <li><b>Square Transactions export</b> (CSV or Excel) becomes income. Only dates, amounts, status and payment IDs are read; names, descriptions, card details and every other column are ignored.</li>
          <li><b>An expense list</b> (any sheets with a first row like Date, Category, Description, Amount) becomes expenses. Only the date, amount, category and vendor are saved; descriptions are used only to suggest categories and are not kept.</li>
        </ul>
        Nothing is saved until you check the preview and confirm. The file itself is never kept.
      </div>
      {added !== null && dupes !== null && <div className="note">Imported {added} payment{s(added)}; skipped {dupes} duplicate{s(dupes)}. <Link href="/">See the dashboard</Link>.</div>}
      {ea !== null && <div className="note">Added {ea} expense{s(ea)}.{ee ? ` ${ee} were already imported.` : ""}{em ? ` ${em} skipped because they match an expense you entered by hand.` : ""}{el ? ` ${el} left out by your choices.` : ""} <Link href="/expenses">See Expenses</Link>.</div>}
      {sp.error && <div className="card err">{sp.error}</div>}
      <ImportForm preview={previewAction} confirm={confirmAction} confirmExpenses={confirmExpensesAction} />
    </main>
  );
}
