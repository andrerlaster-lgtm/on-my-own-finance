import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { loadBooks, flatParams } from "@/lib/accountingPage";
import { addManualEntry } from "@/lib/accountingDb";
import { parseJournalForm, parseSimpleEntry } from "@/lib/journalForms";
import { ENTRY_KIND_LABELS } from "@/lib/ledger";
import { fmtAmount } from "@/lib/statements";
import { rowsToShow } from "@/lib/paging";
import { todayInChicago } from "@/lib/dates";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";
const raw = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
const done = (errors: string[] | null) => redirect(errors ? `/accounting/transactions?error=${encodeURIComponent(errors.join(" | "))}` : "/accounting/transactions?saved=1");

async function simple(fd: FormData) {
  "use server";
  await requireOwner();
  const f = raw(fd), kind = f.kind as "owner_contribution" | "owner_draw" | "transfer";
  if (!["owner_contribution", "owner_draw", "transfer"].includes(kind)) return done(["Unknown entry type."]);
  await requireOwner();
  const { accounts } = await loadBooks();
  const r = parseSimpleEntry(kind, f, accounts, todayInChicago());
  if (!r.ok) return done(r.errors);
  const saved = await addManualEntry(r.value);
  done(saved.ok ? null : saved.errors);
}
async function journal(fd: FormData) {
  "use server";
  await requireOwner();
  const { accounts } = await loadBooks();
  const r = parseJournalForm(raw(fd), accounts, todayInChicago());
  if (!r.ok) return done(r.errors);
  const saved = await addManualEntry(r.value);
  done(saved.ok ? null : saved.errors);
}

export default async function Transactions({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = flatParams(await searchParams), today = todayInChicago();
  const { accounts, ledger } = await loadBooks();
  const kind = p.kind && p.kind in ENTRY_KIND_LABELS ? p.kind : null;
  const all = [...ledger.entries].reverse().filter((e) => !kind || e.kind === kind);
  const shown = rowsToShow(p.rows);
  const active = accounts.filter((a) => a.active);
  const total = (e: (typeof all)[number]) => e.lines.reduce((t, l) => t + l.debit, 0);
  const simpleForm = (k: string, title: string, help: string) => (
    <form action={simple} className="card"><h2>{title}</h2><p className="muted">{help}</p><input type="hidden" name="kind" value={k} />
      <label>Date<input type="date" name="entry_date" defaultValue={today} required /></label>
      <label>Amount ($)<input name="amount" inputMode="decimal" placeholder="0.00" required /></label>
      <label>Description (optional)<input name="description" maxLength={120} /></label>
      <p><SubmitButton>Save</SubmitButton></p></form>
  );
  return (
    <>
      <div className="note">Income, expenses, supply purchases and estimated tax payments are entered on their own pages and appear here automatically as journal entries. Use the forms below only for money moving between you, your bank and Square.</div>
      {p.saved && <div className="note">Saved.</div>}
      {p.error && <div className="card err">{p.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      <div className="tools">
        {simpleForm("owner_contribution", "Owner contribution", "Money you put into the business from your own pocket. It is equity, not income.")}
        {simpleForm("owner_draw", "Owner draw", "Money you took out for yourself. It is equity, not an expense.")}
        {simpleForm("transfer", "Square payout to bank", "Moves money from the Square balance to your bank account. It is a transfer, not income.")}
      </div>
      <details className="card"><summary>Manual or adjusting journal entry</summary>
        <form action={journal}><p className="muted">Debits must equal credits. Saved entries cannot be edited; correct one by posting a reversal.</p>
          <label>Date<input type="date" name="entry_date" defaultValue={today} required /></label>
          <label>Type<select name="kind" defaultValue="manual"><option value="manual">Manual entry</option><option value="adjusting">Adjusting entry</option><option value="opening_balance">Opening balance</option></select></label>
          <label>Description<input name="description" maxLength={120} required /></label>
          <div className="tablewrap"><table><thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead><tbody>
            {[1, 2, 3, 4, 5, 6].map((i) => <tr key={i}><td><select name={`a${i}`} aria-label={`Account, line ${i}`} defaultValue=""><option value="">—</option>{active.map((a) => <option key={a.id} value={a.id}>{a.number} {a.label}</option>)}</select></td>
              <td><input name={`d${i}`} inputMode="decimal" aria-label={`Debit, line ${i}`} /></td><td><input name={`c${i}`} inputMode="decimal" aria-label={`Credit, line ${i}`} /></td></tr>)}
          </tbody></table></div>
          <p><SubmitButton>Save entry</SubmitButton></p></form></details>
      <div className="card"><h2>All journal entries <span className="muted">{all.length}</span></h2>
        <div className="row">{[null, ...Object.keys(ENTRY_KIND_LABELS)].map((k) => <Link key={k ?? "all"} className={`chip${kind === k ? " on" : ""}`} href={k ? `/accounting/transactions?kind=${k}` : "/accounting/transactions"}>{k ? ENTRY_KIND_LABELS[k as keyof typeof ENTRY_KIND_LABELS] : "All"}</Link>)}</div>
        {all.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <ul className="entries">{all.slice(0, shown).map((e) => (
            <li className="entry" key={e.key} id={e.key.replace(":", "-")}><span className="what"><Link href={`/accounting/ledger/entry?key=${encodeURIComponent(e.key)}`}>{e.text}</Link></span><span className="amt">{fmtAmount(total(e))}</span>
              <span className="meta">{e.date} · {ENTRY_KIND_LABELS[e.kind]}</span></li>
          ))}</ul>)}
        {all.length > shown && <p><Link href={`/accounting/transactions?${kind ? `kind=${kind}&` : ""}rows=${shown + 200}`}>Show 200 more</Link></p>}
      </div>
    </>
  );
}
