"use client";
import { useActionState } from "react";
import type { Preview } from "@/lib/squareImport";
import type { ExpenseFlag, Group, SheetSummary } from "@/lib/expenseImport";
import { CATEGORIES } from "@/lib/expenses";
import { SubmitButton } from "./SubmitButton";

export interface ExpensePreview { sheets: SheetSummary[]; groups: Group[]; flags: ExpenseFlag[]; flagsTotal: number; withTaxUsed: number; alreadyImported: number; handMatches: number }
export interface PreviewState { error?: string; kind?: "square" | "expenses"; preview?: Preview; expenses?: ExpensePreview; payload?: string }
type Action = (prev: PreviewState, fd: FormData) => Promise<PreviewState>;
const money = (c: number) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ImportForm({ preview, confirm, confirmExpenses }: { preview: Action; confirm: (fd: FormData) => Promise<void>; confirmExpenses: (fd: FormData) => Promise<void> }) {
  const [state, formAction, pending] = useActionState(preview, {} as PreviewState);
  const p = state.kind === "square" ? state.preview : undefined, e = state.kind === "expenses" ? state.expenses : undefined;
  return (
    <>
      <form action={formAction} className="card">
        <h2>1. Choose the file</h2>
        <input type="file" name="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required aria-label="CSV or Excel file to import" />
        <p><button className="btn" type="submit" disabled={pending}>{pending ? "Reading…" : "Preview"}</button></p>
        {state.error && <p className="err">{state.error}</p>}
      </form>
      {p && state.payload && (
        <div className="card">
          <h2>2. Check the Square preview (nothing is saved yet)</h2>
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
              <ul className="plain">{p.flags.map((f) => <li key={f.row}>Row {f.row}: {f.category}, {f.reason}</li>)}</ul>
              {p.flagsTotal > p.flags.length && <p className="muted">…and {p.flagsTotal - p.flags.length} more.</p>}
            </details>
          )}
          {p.counts.refund > 0 && <p className="muted">Refunded payments are not subtracted anywhere, so revenue can be higher than Square&rsquo;s net. Enter any partly refunded sale by hand if it should count.</p>}
          <form action={confirm}>
            <input type="hidden" name="payload" value={state.payload} />
            <label className="check"><input type="checkbox" name="count_visits" /> Count each imported payment as 1 visit (optional; you can edit visits later on the Income page)</label>
            <p><button className="btn" type="submit" disabled={p.newCount === 0 && p.counts.refund === 0 && p.counts.failed + p.counts.uncertain === 0}>Import {p.newCount} payment{p.newCount === 1 ? "" : "s"}</button></p>
          </form>
        </div>
      )}
      {e && state.payload && (
        <form action={confirmExpenses} className="card">
          <h2>2. Check the expense preview (nothing is saved yet)</h2>
          <input type="hidden" name="payload" value={state.payload} />
          <h3>Sheets to import</h3>
          <ul className="plain">
            {e.sheets.map((sh, i) => (
              <li key={i}>
                <label className="check"><input type="checkbox" name={`sheet_${i}`} defaultChecked={sh.rows > 0} disabled={sh.rows === 0} /> {sh.name}: {sh.rows} expense{sh.rows === 1 ? "" : "s"}, {money(sh.total)}{sh.skipped ? `; ${sh.skipped} row${sh.skipped === 1 ? "" : "s"} skipped` : ""}{!sh.usable ? " (no Amount column)" : ""}</label>
              </li>
            ))}
          </ul>
          <h3>Choose a category for each group</h3>
          <p className="muted">Rows are grouped by their category, or by description when the category is empty. Suggestions marked &ldquo;suggested&rdquo; were guessed from the words; check them. Choose &ldquo;Don&rsquo;t import&rdquo; to leave a group out. Your preparer should confirm the categories.</p>
          <div className="tablewrap">
            <table>
              <thead><tr><th>From your file</th><th>Rows</th><th>Total</th><th>Category in the app</th></tr></thead>
              <tbody>
                {e.groups.map((g, i) => (
                  <tr key={i}>
                    <td>{g.label}{g.note && <div className="muted">{g.note}</div>}</td>
                    <td>{g.count}</td>
                    <td>{money(g.total)}</td>
                    <td>
                      <select name={`map_${i}`} defaultValue={g.guess} aria-label={`Category for ${g.label}`}>
                        {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        <option value="skip">Don&rsquo;t import</option>
                      </select>
                      {g.guessed && g.guess !== "skip" && <span className="muted"> suggested</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {e.withTaxUsed > 0 && <p className="muted">{e.withTaxUsed} row{e.withTaxUsed === 1 ? "" : "s"} had a &ldquo;with tax&rdquo; amount, which was used as the amount paid.</p>}
          {e.alreadyImported > 0 && <p>{e.alreadyImported} row{e.alreadyImported === 1 ? " was" : "s were"} already imported and will be skipped.</p>}
          <label className="check"><input type="checkbox" name="skip_matches" defaultChecked /> Skip rows with the same date and amount as an expense I entered by hand ({e.handMatches} found)</label>
          <p className="muted">Supplies you also recorded as purchases on the Inventory page would be counted twice if imported here too; choose &ldquo;Don&rsquo;t import&rdquo; for those groups.</p>
          {e.flagsTotal > 0 && (
            <details><summary>Rows skipped ({e.flagsTotal})</summary>
              <ul className="plain">{e.flags.map((f, i) => <li key={i}>{f.sheet}, row {f.row}: {f.reason}</li>)}</ul>
              {e.flagsTotal > e.flags.length && <p className="muted">…and {e.flagsTotal - e.flags.length} more.</p>}
            </details>
          )}
          <p><SubmitButton>Import expenses</SubmitButton></p>
        </form>
      )}
    </>
  );
}
