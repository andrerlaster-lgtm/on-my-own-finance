import { requireOwner } from "@/lib/auth";
import { loadBooks } from "@/lib/accountingPage";
import { doubleCountWarnings, ledgerChecks } from "@/lib/ledger";
import { NOT_YET_AVAILABLE } from "@/lib/statements";

export const dynamic = "force-dynamic";

const ROADMAP = [
  { title: "Opening balances", status: "Next", text: "Enter your starting bank, Square and loan balances once. This unlocks the Balance Sheet." },
  { title: "Bank and Square reconciliation", status: "Planned", text: "Match payouts and bank lines to the ledger and prove cash. Needs opening balances first. Payout entries already exist as transfers." },
  { title: "Cash Flow statement", status: "Planned", text: "Follows reconciliation, once beginning and ending cash can be proven." },
  { title: "Accounts payable and receivable", status: "Later", text: "Needed only for accrual reporting. Reports stay cash basis until this exists." },
  { title: "Monthly review and period close", status: "Later", text: "A checklist per month and a lock so closed months cannot change. The ledger already blocks nothing yet." },
];

export default async function Tools() {
  await requireOwner();
  const { input, ledger } = await loadBooks();
  const checks = ledgerChecks(ledger, input), warnings = doubleCountWarnings(input);
  return (
    <>
      <div className="card"><h2>Integrity checks</h2>
        <p className="muted">Re-run every time this page opens, on all of your history. Each check compares the ledger with your own records.</p>
        <ul className="checks">{checks.map((c) => <li key={c.label}><b>{c.ok ? "✓" : "✗"}</b> {c.label}<div className="muted">{c.detail}</div></li>)}</ul>
        {ledger.problems.length > 0 && <div className="card err"><b>Problems found while building the ledger</b><ul>{ledger.problems.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      </div>
      <div className="card"><h2>Possible double counting</h2>
        {warnings.length === 0 ? <p className="muted">Nothing suspicious found.</p> : <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        <p className="muted">Square processing fees are saved on each imported payment, so do not enter them again as expenses. Supply purchases belong in Supplies, not Expenses.</p></div>
      <div className="card"><h2>Journal entries</h2>
        <p className="muted">Manual entries (contributions, draws, payouts, adjustments) are on the Transactions page. They must balance, cannot be edited or deleted, and are corrected by reversal. Every change is also written to the Activity log.</p></div>
      <div className="card"><h2>Mileage</h2>
        <p className="muted">The mileage deduction is an estimate (business miles × the standard rate for the tax year). It is not posted to the ledger and is never an operating expense, so it cannot be counted twice. Reports are under Financial Reports; trips are entered on the Mileage page. Keep actual vehicle costs out of Expenses if the standard rate is used.</p></div>
      <div className="card"><h2>What comes next</h2>
        <ul className="entries">{ROADMAP.map((r) => <li className="entry" key={r.title}><span className="what">{r.title}</span><span className="meta">{r.status}</span><span className="meta">{r.text}</span></li>)}
          {NOT_YET_AVAILABLE.map((r) => <li className="entry" key={r.id}><span className="what">{r.title}</span><span className="meta">Not available yet</span><span className="meta">{r.why}</span></li>)}</ul></div>
    </>
  );
}
