"use client";
import { useActionState } from "react";
import type { Preview } from "@/lib/squareImport";
import type { ExpenseFlag, Group, SheetSummary } from "@/lib/expenseImport";
import type { Choice, Flag, InventoryItemGroup, Source } from "@/lib/masterImport";
import { CATEGORIES } from "@/lib/expenses";
import { MANUAL_SOURCES } from "@/lib/income";
import { PURPOSES, type Purpose } from "@/lib/mileage";
import { SubmitButton } from "./SubmitButton";

type Sheets<T> = ({ index: number; name: string; rows: number; skipped: number } & T)[];
export interface PreviewState {
  error?: string; notes?: string[]; sheetNames?: string[];
  square?: { preview: Preview; payload: string };
  expenses?: { sheets: SheetSummary[]; groups: Group[]; flags: ExpenseFlag[]; flagsTotal: number; withTaxUsed: number; alreadyImported: number; handMatches: number; payload: string };
  inventory?: { sheets: Sheets<{ opening: boolean; undated: number; uncosted: number }>; items: (InventoryItemGroup & { exists: boolean })[]; flags: Flag[]; flagsTotal: number; rounded: number; alreadyImported: number; payload: string };
  mileage?: { sheets: Sheets<{ miles_tenths: number }>; groups: Choice<Purpose>[]; flags: Flag[]; flagsTotal: number; rounded: number; odometerDropped: number; alreadyImported: number; handMatches: number; payload: string };
  income?: { sheets: Sheets<{ total: number }>; groups: Choice<Source>[]; flags: Flag[]; flagsTotal: number; hasTip: boolean; alreadyImported: number; handMatches: number; payload: string };
  services?: { groups: { label: string; count: number }[]; payments: number; imported: number; refundsSkipped: number; accounts: { id: number; label: string }[]; payload: string; squareInThisImport: boolean };
}
type Action = (prev: PreviewState, fd: FormData) => Promise<PreviewState>;
const money = (c: number) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function Skipped({ flags, total }: { flags: { sheet: string; row: number; reason: string }[]; total: number }) {
  if (total === 0) return null;
  return (
    <details><summary>Rows skipped ({total})</summary>
      <ul className="plain">{flags.map((f, i) => <li key={i}>{f.sheet}, row {f.row}: {f.reason}</li>)}</ul>
      {total > flags.length && <p className="muted">…and {total - flags.length} more.</p>}
    </details>
  );
}
function Section({ name, title, children }: { name: string; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="card">
      <legend><label className="check"><input type="checkbox" name={name} defaultChecked /> <b>{title}</b></label></legend>
      {children}
    </fieldset>
  );
}
function ChoiceTable<T extends string>({ prefix, groups, options, what, amount }: { prefix: string; groups: Choice<T>[]; options: readonly { id: string; label: string }[]; what: string; amount: (c: number) => string }) {
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th>From your file</th><th>Rows</th><th>Total</th><th>{what}</th></tr></thead>
        <tbody>{groups.map((g, i) => (
          <tr key={i}>
            <td>{g.label}{g.note && <div className="muted">{g.note}</div>}</td><td>{g.count}</td><td>{amount(g.total)}</td>
            <td>
              <select name={`${prefix}_map_${i}`} defaultValue={g.guess} aria-label={`${what} for ${g.label}`}>
                {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                <option value="skip">Don&rsquo;t import</option>
              </select>
              {g.guessed && g.guess !== "skip" && <span className="muted"> suggested</span>}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
function SheetBoxes({ prefix, sheets, describe }: { prefix: string; sheets: { index: number; name: string; rows: number; skipped: number }[]; describe: (s: never) => string }) {
  return (
    <ul className="plain">{sheets.map((sh, i) => (
      <li key={sh.index}><label className="check"><input type="checkbox" name={`${prefix}_sheet_${prefix === "exp" ? i : sh.index}`} defaultChecked={sh.rows > 0} disabled={sh.rows === 0} /> {sh.name}: {describe(sh as never)}{sh.skipped ? `; ${plural(sh.skipped, "row")} skipped` : ""}</label></li>
    ))}</ul>
  );
}

export function ImportForm({ preview, confirm }: { preview: Action; confirm: (fd: FormData) => Promise<void> }) {
  const [state, formAction, pending] = useActionState(preview, {} as PreviewState);
  const { square, expenses: e, inventory: inv, mileage: mi, income: inc, services: sv } = state;
  const any = square || e || inv || mi || inc || sv;
  return (
    <>
      <form action={formAction} className="card">
        <h2>1. Choose the files</h2>
        <input type="file" name="file" multiple accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required aria-label="CSV or Excel files to import" />
        <p><label>What&rsquo;s in them? <select name="kind" defaultValue="auto">
          <option value="auto">Work it out from the column names</option>
          <option value="expenses">Expenses</option><option value="inventory">Inventory (supplies bought or on hand)</option>
          <option value="mileage">Mileage log</option><option value="income">Cash, check and other income</option>
        </select></label></p>
        <p className="muted">Choose a type only if a file is sorted wrongly; it then applies to every sheet you upload. Square files are always recognized.</p>
        <p><button className="btn" type="submit" disabled={pending}>{pending ? "Reading…" : "Preview"}</button></p>
        {state.error && <p className="err">{state.error}</p>}
      </form>

      {state.notes && state.notes.length > 0 && <div className="note"><ul className="plain">{state.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>}

      {any && (
        <form action={confirm}>
          <h2>2. Check the preview (nothing is saved yet)</h2>

          {square && (() => { const p = square.preview; return (
            <Section name="do_square" title={`Square transactions → Income (${plural(p.newCount, "new payment")})`}>
              <input type="hidden" name="square_payload" value={square.payload} />
              <p>{p.counts.read} rows read{p.firstDate ? `, dated ${p.firstDate} to ${p.lastDate}` : ""}.</p>
              <ul className="plain">
                <li><b>{p.newCount}</b> new payment{p.newCount === 1 ? "" : "s"} would be added</li>
                <li>{p.alreadyImported + p.counts.duplicateInFile} duplicate{p.alreadyImported + p.counts.duplicateInFile === 1 ? "" : "s"} skipped ({p.alreadyImported} already imported, {p.counts.duplicateInFile} repeated in the file)</li>
                <li>{p.counts.refund} refund row{p.counts.refund === 1 ? "" : "s"} flagged, not counted</li>
                <li>{p.counts.failed} failed or declined, not counted</li>
                <li>{p.counts.uncertain} unclear, not counted</li>
              </ul>
              <div className="grid2">
                <div className="stat">Revenue (excludes tips and refunds)<b>{money(p.revenue)}</b></div>
                <div className="stat">Tips<b>{money(p.tips)}</b></div>
                <div className="stat">Processing fees<b>{money(p.fees)}</b></div>
                <div className="stat">Net after fees, before expenses<b>{money(p.netAfterFees)}</b></div>
              </div>
              {p.unknownStatuses.length > 0 && <p className="muted">Statuses not recognized as completed: {p.unknownStatuses.join(", ")}. If these should count, update src/lib/squareFormat.ts.</p>}
              {p.flagsTotal > 0 && (
                <details><summary>Rows not counted ({p.flagsTotal})</summary>
                  <ul className="plain">{p.flags.map((f, i) => <li key={i}>Row {f.row}: {f.category}, {f.reason}</li>)}</ul>
                  {p.flagsTotal > p.flags.length && <p className="muted">…and {p.flagsTotal - p.flags.length} more.</p>}
                </details>
              )}
              {p.counts.refund > 0 && <p className="muted">Refunded payments are not subtracted anywhere, so revenue can be higher than Square&rsquo;s net. Enter any partly refunded sale by hand if it should count.</p>}
              <label className="check"><input type="checkbox" name="count_visits" /> Count each imported payment as 1 visit (optional; you can edit visits later on the Income page)</label>
            </Section>
          ); })()}

          {e && (
            <Section name="do_expenses" title="Expenses → Expenses">
              <input type="hidden" name="expenses_payload" value={e.payload} />
              <SheetBoxes prefix="exp" sheets={e.sheets.map((s, i) => ({ ...s, index: i }))} describe={(s: SheetSummary) => `${plural(s.rows, "expense")}, ${money(s.total)}${!s.usable ? " (no Amount column)" : ""}`} />
              <p className="muted">Rows are grouped by category, or by description when the category is empty. &ldquo;Suggested&rdquo; means guessed from the words; check them. Your preparer should confirm the categories.</p>
              <ChoiceTable prefix="exp" groups={e.groups} options={CATEGORIES} what="Category in the app" amount={money} />
              {e.withTaxUsed > 0 && <p className="muted">{plural(e.withTaxUsed, "row")} had a &ldquo;with tax&rdquo; amount, which was used as the amount paid.</p>}
              {e.alreadyImported > 0 && <p>{plural(e.alreadyImported, "row")} already imported will be skipped.</p>}
              <label className="check"><input type="checkbox" name="exp_skip" defaultChecked /> Skip rows with the same date and amount as an expense I entered by hand ({e.handMatches} found)</label>
              <p className="muted">Supplies you also import as inventory (below, or on the Inventory page) would be counted twice; choose &ldquo;Don&rsquo;t import&rdquo; for those groups here.</p>
              <Skipped flags={e.flags} total={e.flagsTotal} />
            </Section>
          )}

          {inv && (
            <Section name="do_inventory" title="Inventory → Inventory ledger (not expenses)">
              <input type="hidden" name="inventory_payload" value={inv.payload} />
              <ul className="plain">{inv.sheets.map((sh) => (
                <li key={sh.index}>
                  <label className="check"><input type="checkbox" name={`inv_sheet_${sh.index}`} defaultChecked={sh.rows > 0} disabled={sh.rows === 0} /> {sh.name}: {plural(sh.rows, "row")}{sh.skipped ? `; ${plural(sh.skipped, "row")} skipped` : ""}</label>
                  {sh.rows > 0 && <div>
                    <label>These rows are <select name={`inv_kind_${sh.index}`} defaultValue={sh.opening ? "opening" : "purchase"}><option value="purchase">purchases</option><option value="opening">opening stock (what I had on hand)</option></select></label>
                    {sh.undated > 0 && <label> Date for the {sh.undated} row{sh.undated === 1 ? "" : "s"} with no date <input type="date" name={`inv_date_${sh.index}`} /></label>}
                  </div>}
                </li>
              ))}</ul>
              <div className="tablewrap"><table>
                <thead><tr><th>Item</th><th>Rows</th><th>Units</th><th>In the app</th></tr></thead>
                <tbody>{inv.items.map((it, i) => (
                  <tr key={i}><td>{it.label}<div className="muted">{it.exists ? "adds to your existing item" : `new item (unit: ${it.unit}, category: ${it.category})`}</div></td><td>{it.count}</td><td>{it.quantity}</td>
                    <td><select name={`inv_item_${i}`} defaultValue="import" aria-label={`Import ${it.label}`}><option value="import">Import</option><option value="skip">Don&rsquo;t import</option></select></td></tr>
                ))}</tbody>
              </table></div>
              {inv.sheets.some((s) => s.uncosted > 0) && <label className="check"><input type="checkbox" name="inv_zero" /> Import rows with no cost at $0.00 (otherwise they are skipped; a $0 cost lowers the average cost)</label>}
              {inv.rounded > 0 && <p className="muted">{plural(inv.rounded, "row")} had a total cost that doesn&rsquo;t divide evenly by the quantity; the cost per unit was rounded to the cent.</p>}
              {inv.alreadyImported > 0 && <p>{plural(inv.alreadyImported, "row")} already imported will be skipped.</p>}
              <p className="muted">Inventory is a separate ledger: buying stock is not an expense, so don&rsquo;t also import these purchases as expenses.</p>
              <Skipped flags={inv.flags} total={inv.flagsTotal} />
            </Section>
          )}

          {mi && (
            <Section name="do_mileage" title="Mileage log → Mileage">
              <input type="hidden" name="mileage_payload" value={mi.payload} />
              <SheetBoxes prefix="mi" sheets={mi.sheets} describe={(s: { rows: number; miles_tenths: number }) => `${plural(s.rows, "trip")}, ${(s.miles_tenths / 10).toFixed(1)} miles`} />
              <ChoiceTable prefix="mi" groups={mi.groups} options={PURPOSES} what="Purpose in the app" amount={(t) => `${(t / 10).toFixed(1)} mi`} />
              <p className="muted">Only the date, miles, purpose and odometer readings are saved. Addresses and places are never read.{mi.rounded ? ` ${plural(mi.rounded, "trip")} rounded to a tenth of a mile.` : ""}{mi.odometerDropped ? ` ${mi.odometerDropped} had odometer readings that didn't make sense; those readings were left out.` : ""}</p>
              {mi.alreadyImported > 0 && <p>{plural(mi.alreadyImported, "trip")} already imported will be skipped.</p>}
              <label className="check"><input type="checkbox" name="mi_skip" defaultChecked /> Skip trips with the same date and miles as one I entered by hand ({mi.handMatches} found)</label>
              <Skipped flags={mi.flags} total={mi.flagsTotal} />
            </Section>
          )}

          {inc && (
            <Section name="do_income" title="Cash, check and other income → Income">
              <input type="hidden" name="income_payload" value={inc.payload} />
              <SheetBoxes prefix="in" sheets={inc.sheets} describe={(s: { rows: number; total: number }) => `${plural(s.rows, "entry")}, ${money(s.total)}`} />
              <ChoiceTable prefix="in" groups={inc.groups} options={MANUAL_SOURCES} what="How it was paid" amount={money} />
              {inc.hasTip && <label className="check"><input type="checkbox" name="in_tipincl" /> The amount column already includes the tip (revenue = amount − tip)</label>}
              <p className="muted">Entries are saved with tax form &ldquo;not decided&rdquo; and no payer; set those on the Income page. Payer and name columns are never read.</p>
              {inc.alreadyImported > 0 && <p>{plural(inc.alreadyImported, "entry")} already imported will be skipped.</p>}
              <label className="check"><input type="checkbox" name="in_skip" defaultChecked /> Skip rows with the same date and amounts as an entry I entered by hand ({inc.handMatches} found)</label>
              <Skipped flags={inc.flags} total={inc.flagsTotal} />
            </Section>
          )}

          {sv && (
            <Section name="do_services" title="Square item details → Revenue by Service">
              <input type="hidden" name="services_payload" value={sv.payload} />
              <p>{plural(sv.payments, "Square payment")} in the file; {sv.imported} already imported from the Transactions export{sv.squareInThisImport ? " (payments in the Square section above are imported first)" : ""}. Only entries with no revenue account yet are changed; money is never changed.{sv.refundsSkipped ? ` ${plural(sv.refundsSkipped, "refund line")} ignored.` : ""}</p>
              {sv.accounts.length <= 1 && <p className="err">You have {sv.accounts.length} revenue account. Add one per service under Accounting &gt; Chart of Accounts (for example 4010 Mobile draws, 4020 Specimen pickup), then preview again.</p>}
              <div className="tablewrap"><table>
                <thead><tr><th>Service in Square</th><th>Lines</th><th>Revenue account</th></tr></thead>
                <tbody>{sv.groups.map((g, i) => (
                  <tr key={i}><td>{g.label}</td><td>{g.count}</td>
                    <td><select name={`svc_map_${i}`} defaultValue="" aria-label={`Revenue account for ${g.label}`}><option value="">Leave as is</option>{sv.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></td></tr>
                ))}</tbody>
              </table></div>
              <p className="muted">A payment whose services go to two different accounts is left alone, because one entry can&rsquo;t be split.</p>
            </Section>
          )}

          <p><SubmitButton>Import the ticked sections</SubmitButton></p>
        </form>
      )}
    </>
  );
}
