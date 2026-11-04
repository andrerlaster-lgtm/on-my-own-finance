"use client";
import { useActionState } from "react";
import type { Preview } from "@/lib/squareImport";

export interface PreviewState { error?: string; preview?: Preview; payload?: string }
type Action = (prev: PreviewState, fd: FormData) => Promise<PreviewState>;
const money = (c: number) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ImportForm({ preview, confirm }: { preview: Action; confirm: (fd: FormData) => Promise<void> }) {
  const [state, formAction, pending] = useActionState(preview, {} as PreviewState);
  const p = state.preview;
  return (
    <>
      <form action={formAction} className="card">
        <h2>1. Choose the Square file</h2>
        <input type="file" name="file" accept=".csv,text/csv" required aria-label="Square transactions CSV file" />
        <p><button className="btn" type="submit" disabled={pending}>{pending ? "Reading…" : "Preview"}</button></p>
        {state.error && <p className="err">{state.error}</p>}
      </form>
      {p && state.payload && (
        <div className="card">
          <h2>2. Check the preview (nothing is saved yet)</h2>
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
    </>
  );
}
