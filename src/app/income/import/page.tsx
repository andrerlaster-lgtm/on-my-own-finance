import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import {
  assignServiceAccounts, databaseReady, existingExpenseImportKeys, existingImportKeys, existingSquareIds, handEnteredExpensePairs, handEnteredIncomePairs,
  handEnteredTripPairs, importExpenseRows, importIncomeRows, importInventoryRows, importSquareRows, importTripRows, inventoryItemNames, revenueAccounts,
} from "@/lib/db";
import { buildPreview, csvRecords, otherSquareExport, parsePayload, parseSquareRecords, serializePayload, type Counts, type ImportRow, type Flag as SquareFlag } from "@/lib/squareImport";
import { isCategory, parseExpensePayload, parseExpenseSheets, planExpenseImport, serializeExpensePayload } from "@/lib/expenseImport";
import {
  CHOOSABLE, detectKind, KIND_LABELS, parseIncome, parseIncomePayload, parseInventory, parseInventoryPayload, parseMileage, parseMileagePayload, parseServices,
  parseServicesPayload, planRows, planServices, serializeIncome, serializeInventory, serializeMileage, serializeServices, splitIncome, type ImportKind,
} from "@/lib/masterImport";
import { readXlsx, sniff, type Sheet } from "@/lib/xlsxRead";
import { LIMITS } from "@/lib/squareFormat";
import { parseDate } from "@/lib/dates";
import type { Category } from "@/lib/expenses";
import { MANUAL_SOURCES } from "@/lib/income";
import { PURPOSES } from "@/lib/mileage";
import { ImportForm, type PreviewState } from "@/components/ImportForm";

export const dynamic = "force-dynamic";
const MAX_FILES = 10;
const span = (dates: string[]) => { const d = [...dates].sort(); return d.length ? [d[0], d[d.length - 1]] as const : null; };

async function readFiles(files: File[]): Promise<{ ok: true; sheets: Sheet[] } | { ok: false; error: string }> {
  const sheets: Sheet[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer()), many = files.length > 1;
    const name = (s: string) => (many ? `${file.name.slice(0, 40)}: ${s}` : s);
    switch (sniff(bytes, file.name)) {
      case "xlsx": { const r = readXlsx(bytes); if (!r.ok) return { ok: false, error: `${file.name}: ${r.error}` }; for (const s of r.sheets) sheets.push({ name: name(s.name), rows: s.rows }); break; }
      case "xls": return { ok: false, error: `${file.name} is the old Excel format (.xls). Open it in Excel and save it as .xlsx (Excel Workbook) or CSV, then try again.` };
      case "csv":
        try { sheets.push({ name: many ? file.name.slice(0, 60) : "CSV file", rows: [...csvRecords(new TextDecoder("utf-8").decode(bytes))] }); }
        catch { return { ok: false, error: `${file.name} has an unclosed quotation mark, so it can't be read.` }; }
        break;
      default: return { ok: false, error: `${file.name}: only CSV and Excel (.xlsx) files can be imported.` };
    }
  }
  return { ok: true, sheets };
}

async function previewAction(_prev: PreviewState, fd: FormData): Promise<PreviewState> {
  "use server";
  await requireOwner();
  const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { error: "Choose one or more CSV or Excel files." };
  if (files.length > MAX_FILES) return { error: `Choose up to ${MAX_FILES} files at a time.` };
  if (files.reduce((t, f) => t + f.size, 0) > LIMITS.fileBytes) return { error: "Those files are too large together (2 MB limit). Import fewer at a time, or export a shorter date range." };
  const read = await readFiles(files);
  if (!read.ok) return { error: read.error };
  const forced = String(fd.get("kind") ?? "auto") as ImportKind | "auto";
  const byKind = new Map<ImportKind, { index: number; sheet: Sheet }[]>(), notes: string[] = [];
  read.sheets.forEach((sheet, index) => {
    if (sheet.rows.length === 0) return;
    const kind = forced !== "auto" && CHOOSABLE.includes(forced) ? forced : detectKind(sheet);
    if (!kind) { notes.push(`${sheet.name}: not recognized, skipped. Its first row should name the columns (for example Date, Amount, Miles, Item, Quantity).`); return; }
    if (kind === "square_summary") { notes.push(`${sheet.name}: ${otherSquareExport([[ "Sales summary" ]])}`); return; }
    (byKind.get(kind) ?? byKind.set(kind, []).get(kind)!).push({ index, sheet });
  });
  const state: PreviewState = { notes, sheetNames: read.sheets.map((s) => s.name) };

  const sq = byKind.get("square");
  if (sq) {
    const rows: ImportRow[] = [], flags: SquareFlag[] = [], seen = new Set<string>(), unknown = new Set<string>();
    const counts: Counts = { read: 0, importable: 0, duplicateInFile: 0, refund: 0, failed: 0, uncertain: 0 };
    for (const { sheet } of sq) {
      const out = parseSquareRecords(sheet.rows);
      if (!out.ok) { notes.push(`${sheet.name}: ${out.error}`); continue; }
      for (const k of Object.keys(counts) as (keyof Counts)[]) counts[k] += out.counts[k];
      for (const r of out.rows) { if (seen.has(r.external_id)) counts.duplicateInFile++; else { seen.add(r.external_id); rows.push(r); } }
      flags.push(...out.flags); out.unknownStatuses.forEach((u) => unknown.add(u));
    }
    if (rows.length > LIMITS.importableRows) return { error: `More than ${LIMITS.importableRows} Square payments at once. Import fewer files.` };
    counts.importable = rows.length;
    const dates = span(rows.map((r) => r.occurred_on));
    const out = { ok: true as const, rows, counts, flags, unknownStatuses: [...unknown].slice(0, 10), firstDate: dates?.[0] ?? null, lastDate: dates?.[1] ?? null };
    if (counts.read > 0) state.square = { preview: buildPreview(out, await existingSquareIds(rows.map((r) => r.external_id))), payload: serializePayload(rows, counts) };
  }

  const ex = byKind.get("expenses");
  if (ex) {
    const out = parseExpenseSheets(ex.map((x) => x.sheet));
    if (!out.ok) notes.push(out.error);
    else if (out.rows.length) {
      const d = span(out.rows.map((r) => r.spent_on))!;
      const plan = planExpenseImport(out.rows, { sheets: new Set(out.sheets.map((_, i) => i)), map: new Map(out.groups.map((g, i) => [i, g.guess])), skipMatches: true, alreadyImported: await existingExpenseImportKeys(out.rows.map((r) => r.key)), handEntered: await handEnteredExpensePairs(d[0], d[1]) });
      state.expenses = { sheets: out.sheets, groups: out.groups, flags: out.flags, flagsTotal: out.flagsTotal, withTaxUsed: out.withTaxUsed, alreadyImported: plan.alreadyImported, handMatches: plan.matchedHandEntered, payload: serializeExpensePayload(out.rows, out.groups.length, out.sheets.length) };
    }
  }

  const inv = byKind.get("inventory");
  if (inv) {
    const out = parseInventory(inv);
    if (out.rows.length) {
      const existing = await inventoryItemNames();
      const already = await existingImportKeys("inventory_movements", out.rows.map((r) => r.key));
      state.inventory = {
        sheets: inv.map(({ index }) => ({ index, ...out.sheets[index] })), items: out.items.map((i) => ({ ...i, exists: existing.has(i.label.toLowerCase()) })),
        flags: out.flags.slice(0, 50), flagsTotal: out.flags.length, rounded: out.rounded, alreadyImported: out.rows.filter((r) => already.has(r.key)).length, payload: serializeInventory(out),
      };
    }
  }

  const mi = byKind.get("mileage");
  if (mi) {
    const out = parseMileage(mi);
    if (out.rows.length) {
      const d = span(out.rows.map((r) => r.driven_on))!;
      const plan = planRows(out.rows, (r) => out.groups[r.group].guess !== "skip", await existingImportKeys("mileage_trips", out.rows.map((r) => r.key)), { pair: (r) => `${r.driven_on}|${r.miles_tenths}`, counts: await handEnteredTripPairs(d[0], d[1]) });
      state.mileage = { sheets: mi.map(({ index }) => ({ index, ...out.sheets[index] })), groups: out.groups, flags: out.flags.slice(0, 50), flagsTotal: out.flags.length, rounded: out.rounded, odometerDropped: out.odometerDropped, alreadyImported: plan.alreadyImported, handMatches: plan.matchedHandEntered, payload: serializeMileage(out) };
    }
  }

  const inc = byKind.get("income");
  if (inc) {
    const out = parseIncome(inc);
    if (out.rows.length) {
      const d = span(out.rows.map((r) => r.occurred_on))!;
      const plan = planRows(out.rows, (r) => out.groups[r.group].guess !== "skip", await existingImportKeys("income_entries", out.rows.map((r) => r.key)), { pair: (r) => `${r.occurred_on}|${r.amount_cents}|${r.tip_cents}`, counts: await handEnteredIncomePairs(d[0], d[1]) });
      state.income = { sheets: inc.map(({ index }) => ({ index, ...out.sheets[index] })), groups: out.groups, flags: out.flags.slice(0, 50), flagsTotal: out.flags.length, hasTip: out.hasTip, alreadyImported: plan.alreadyImported, handMatches: plan.matchedHandEntered, payload: serializeIncome(out) };
    }
  }

  const sv = byKind.get("square_items");
  if (sv) {
    const out = parseServices(sv);
    if (out.payments.length) {
      const imported = await existingSquareIds(out.payments.map((p) => p.external_id));
      state.services = { groups: out.groups, payments: out.payments.length, imported: imported.size, refundsSkipped: out.refundsSkipped, accounts: await revenueAccounts(), payload: serializeServices(out), squareInThisImport: Boolean(state.square) };
    }
  }

  if (!state.square && !state.expenses && !state.inventory && !state.mileage && !state.income && !state.services) return { error: notes.length ? notes.join(" ") : "Nothing to import was found in those files." };
  return state;
}

async function confirmAction(fd: FormData) {
  "use server";
  await requireOwner();
  const done: string[] = [];
  const on = (k: string) => fd.get(k) === "on";
  const bad = (what: string) => redirect(`/income/import?error=${encodeURIComponent(`The ${what} import data was not readable. Choose the files again.`)}`);

  if (on("do_square")) {
    const p = parsePayload(String(fd.get("square_payload") ?? ""));
    if (!p.ok) bad("Square");
    else { const r = await importSquareRows(p.rows, p.counts, on("count_visits") ? 1 : 0); done.push(`Square: ${r.added} payments added, ${r.duplicates} duplicates skipped.`); }
  }

  if (on("do_expenses")) {
    const p = parseExpensePayload(String(fd.get("expenses_payload") ?? ""));
    if (!p.ok) bad("expense");
    else {
      const sheets = new Set<number>(), map = new Map<number, Category | "skip">();
      for (let i = 0; i < p.sheetCount; i++) if (on(`exp_sheet_${i}`)) sheets.add(i);
      for (let g = 0; g < p.groupCount; g++) { const v = String(fd.get(`exp_map_${g}`) ?? ""); if (v === "skip" || isCategory(v)) map.set(g, v); }
      const d = span(p.rows.map((r) => r.spent_on));
      const plan = planExpenseImport(p.rows, { sheets, map, skipMatches: on("exp_skip"), alreadyImported: await existingExpenseImportKeys(p.rows.map((r) => r.key)), handEntered: d ? await handEnteredExpensePairs(d[0], d[1]) : new Map() });
      const added = await importExpenseRows(plan.add.map((r) => ({ spent_on: r.spent_on, amount_cents: r.amount_cents, category: r.category, vendor: r.vendor, key: r.key })));
      done.push(`Expenses: ${added} added, ${plan.alreadyImported + plan.add.length - added} already imported, ${plan.matchedHandEntered} matched ones you entered by hand, ${plan.notChosen} left out.`);
    }
  }

  if (on("do_inventory")) {
    const p = parseInventoryPayload(String(fd.get("inventory_payload") ?? ""));
    if (!p) bad("inventory");
    else {
      const zero = on("inv_zero");
      let undated = 0, uncosted = 0, left = 0;
      const rows = p.rows.flatMap((r) => {
        if (!on(`inv_sheet_${r.sheet}`) || fd.get(`inv_item_${r.item}`) !== "import") { left++; return []; }
        const moved_on = r.moved_on ?? parseDate(String(fd.get(`inv_date_${r.sheet}`) ?? ""));
        if (!moved_on) { undated++; return []; }
        if (r.unit_cost_cents === null && !zero) { uncosted++; return []; }
        const it = p.items[r.item];
        return [{ label: it.label, unit: it.unit, category: it.category, moved_on, kind: fd.get(`inv_kind_${r.sheet}`) === "opening" ? "opening" as const : "purchase" as const, quantity: r.quantity, unit_cost_cents: r.unit_cost_cents ?? 0, lot_number: r.lot_number, expires_on: r.expires_on, key: r.key }];
      });
      const r = await importInventoryRows(rows);
      done.push(`Inventory: ${r.added} movements added (${r.newItems} new items), ${rows.length - r.added - r.lotConflicts} already imported, ${left} left out${undated ? `, ${undated} with no date` : ""}${uncosted ? `, ${uncosted} with no cost` : ""}${r.lotConflicts ? `, ${r.lotConflicts} refused because the lot already has a different expiry date` : ""}.`);
    }
  }

  if (on("do_mileage")) {
    const p = parseMileagePayload(String(fd.get("mileage_payload") ?? ""));
    if (!p) bad("mileage");
    else {
      const purpose = (g: number) => { const v = String(fd.get(`mi_map_${g}`) ?? ""); return PURPOSES.some((x) => x.id === v) ? v : null; };
      const d = span(p.rows.map((r) => r.driven_on));
      const plan = planRows(p.rows, (r) => on(`mi_sheet_${r.sheet}`) && purpose(r.group) !== null, await existingImportKeys("mileage_trips", p.rows.map((r) => r.key)), on("mi_skip") && d ? { pair: (r) => `${r.driven_on}|${r.miles_tenths}`, counts: await handEnteredTripPairs(d[0], d[1]) } : undefined);
      const added = await importTripRows(plan.add.map((r) => ({ driven_on: r.driven_on, miles_tenths: r.miles_tenths, purpose: purpose(r.group)!, odometer_start: r.odometer_start, odometer_end: r.odometer_end, key: r.key })));
      done.push(`Mileage: ${added} trips added, ${plan.alreadyImported + plan.add.length - added} already imported, ${plan.matchedHandEntered} matched trips you entered by hand, ${plan.notChosen} left out.`);
    }
  }

  if (on("do_income")) {
    const p = parseIncomePayload(String(fd.get("income_payload") ?? ""));
    if (!p) bad("income");
    else {
      const source = (g: number) => { const v = String(fd.get(`in_map_${g}`) ?? ""); return MANUAL_SOURCES.some((x) => x.id === v) ? v : null; };
      const incl = on("in_tipincl");
      let bad2 = 0;
      const d = span(p.rows.map((r) => r.occurred_on));
      const plan = planRows(p.rows, (r) => on(`in_sheet_${r.sheet}`) && source(r.group) !== null, await existingImportKeys("income_entries", p.rows.map((r) => r.key)), on("in_skip") && d ? { pair: (r) => { const s = splitIncome(r, incl); return s ? `${r.occurred_on}|${s.gross}|${s.tip}` : ""; }, counts: await handEnteredIncomePairs(d[0], d[1]) } : undefined);
      const rows = plan.add.flatMap((r) => {
        const s = splitIncome(r, incl);
        if (!s || r.fee_cents > s.gross + s.tip || s.gross + s.tip === 0) { bad2++; return []; }
        return [{ occurred_on: r.occurred_on, source: source(r.group)!, gross_cents: s.gross, tip_cents: s.tip, fee_cents: r.fee_cents, visits: r.visits, key: r.key }];
      });
      const added = await importIncomeRows(rows);
      done.push(`Income: ${added} entries added (tax form "not decided"), ${plan.alreadyImported + rows.length - added} already imported, ${plan.matchedHandEntered} matched entries you entered by hand, ${plan.notChosen} left out${bad2 ? `, ${bad2} with a tip or fee larger than the amount` : ""}.`);
    }
  }

  if (on("do_services")) {
    const p = parseServicesPayload(String(fd.get("services_payload") ?? ""));
    if (!p) bad("services");
    else {
      const valid = new Set((await revenueAccounts()).map((a) => a.id)), map = new Map<number, number>();
      for (let g = 0; g < p.groups; g++) { const v = Number(fd.get(`svc_map_${g}`) ?? ""); if (valid.has(v)) map.set(g, v); }
      const plan = planServices(p.payments, map), r = await assignServiceAccounts(plan.assign);
      done.push(`Services: ${r.set} Square payments sorted into a revenue account${r.notImported ? `, ${r.notImported} not imported from Square yet` : ""}${plan.mixed ? `, ${plan.mixed} left alone because they mix services in different accounts` : ""}.`);
    }
  }
  redirect(`/income/import?done=${encodeURIComponent(done.join("\n") || "Nothing was selected to import.")}`);
}

export default async function ImportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const sp = await searchParams;
  const done = (sp.done ?? "").slice(0, 2000).split("\n").filter(Boolean);
  return (
    <main>
      <p><Link href="/income">← Income</Link></p>
      <h1>Import files</h1>
      <div className="note">
        Choose one or more CSV or Excel (.xlsx) files. Every sheet is sorted into the right place:
        <ul className="plain">
          <li><b>{KIND_LABELS.square}</b> and <b>{KIND_LABELS.square_items}</b>: Square exports. The item details only sort Square payments into revenue accounts for Revenue by Service; they never change money.</li>
          <li><b>{KIND_LABELS.expenses}</b>, <b>{KIND_LABELS.inventory}</b>, <b>{KIND_LABELS.mileage}</b>, <b>{KIND_LABELS.income}</b>: your own spreadsheets, with a first row that names the columns.</li>
        </ul>
        Only the columns the app needs are read. Names, addresses, payers, notes and card details are skipped and never saved. Nothing is saved until you check the preview and press Import. The files themselves are never kept.
      </div>
      {done.length > 0 && <div className="note"><b>Imported.</b><ul className="plain">{done.map((d, i) => <li key={i}>{d}</li>)}</ul></div>}
      {sp.error && <div className="card err">{sp.error}</div>}
      <ImportForm preview={previewAction} confirm={confirmAction} />
    </main>
  );
}
