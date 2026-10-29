import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { loadBooks, flatParams } from "@/lib/accountingPage";
import { reverseEntry, setMapping } from "@/lib/accountingDb";
import { ENTRY_KIND_LABELS } from "@/lib/ledger";
import { fmtAmount, ledgerHref } from "@/lib/statements";
import { todayInChicago, parseDate } from "@/lib/dates";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";
const back = (key: string, q: string) => `/accounting/ledger/entry?key=${encodeURIComponent(key)}${q}`;

async function classify(fd: FormData) {
  "use server";
  await requireOwner();
  const key = String(fd.get("key") ?? ""), m = /^(income|expense):(\d{1,12})$/.exec(key);
  if (!m) redirect("/accounting/ledger");
  const raw = String(fd.get("account_id") ?? ""), id = /^\d{1,12}$/.test(raw) ? Number(raw) : null;
  await setMapping(m![1] as "income" | "expense", Number(m![2]), id);
  redirect(back(key, "&saved=1"));
}

async function reverse(fd: FormData) {
  "use server";
  await requireOwner();
  const key = String(fd.get("key") ?? ""), m = /^manual:(\d{1,12})$/.exec(key);
  if (!m) redirect("/accounting/ledger");
  const date = parseDate(String(fd.get("date") ?? "")) ?? todayInChicago();
  const err = await reverseEntry(Number(m![1]), date);
  redirect(back(key, err ? `&error=${encodeURIComponent(err)}` : "&saved=1"));
}

export default async function EntryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = flatParams(await searchParams);
  await requireOwner();
  const { accounts, ledger, input } = await loadBooks();
  const entry = ledger.entries.find((e) => e.key === p.key);
  if (!entry) return <div className="card"><p>That entry was not found. <Link href="/accounting/ledger">Back to the General Ledger</Link></p></div>;
  const acct = (id: number) => accounts.find((a) => a.id === id);
  const debits = entry.lines.reduce((t, l) => t + l.debit, 0), credits = entry.lines.reduce((t, l) => t + l.credit, 0);
  const kindOfSource = entry.key.startsWith("income:") ? "income" : entry.key.startsWith("expense:") ? "expense" : null;
  const target = kindOfSource === "income" ? accounts.filter((a) => a.type === "revenue" && a.active) : accounts.filter((a) => (a.type === "operating_expense" || a.type === "cost_of_services") && a.active);
  const chosen = kindOfSource === "income" ? input.incomeAccounts?.[Number(entry.key.split(":")[1])] : kindOfSource === "expense" ? input.expenseAccounts?.[Number(entry.key.split(":")[1])] : undefined;
  const manual = entry.key.startsWith("manual:") ? input.manual.find((m) => m.id === Number(entry.key.split(":")[1])) : undefined;
  const reversed = manual ? input.manual.some((m) => m.reverses_id === manual.id) : false;
  return (
    <>
      <p><Link href="/accounting/ledger">← General Ledger</Link></p>
      {p.saved && <div className="note">Saved.</div>}
      {p.error && <div className="card err">{p.error}</div>}
      <div className="card">
        <h2>{entry.text}</h2>
        <p className="muted">{entry.date} · {ENTRY_KIND_LABELS[entry.kind]} · entry {entry.key}{entry.href ? <> · <Link href={entry.href}>Open the source record</Link></> : null}</p>
        <div className="tablewrap"><table className="stmt"><thead><tr><th>Account</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>{entry.lines.map((l, i) => { const a = acct(l.accountId); return <tr key={i}><td>{a ? <Link href={ledgerHref(a.id, { from: `${entry.date.slice(0, 4)}-01-01`, to: entry.date })}>{a.number} {a.label}</Link> : "?"}</td><td>{l.text}</td><td className="num">{l.debit ? fmtAmount(l.debit) : ""}</td><td className="num">{l.credit ? fmtAmount(l.credit) : ""}</td></tr>; })}</tbody>
          <tfoot><tr><th colSpan={2}>Total</th><td className="num">{fmtAmount(debits)}</td><td className="num">{fmtAmount(credits)}</td></tr></tfoot></table></div>
        <p className="muted">{debits === credits ? "Balanced: debits equal credits." : "Out of balance. Open Accounting Tools."}</p>
      </div>
      {kindOfSource && (
        <form action={classify} className="card"><h2>Which account should this post to?</h2>
          <p className="muted">Changing this moves the amount between accounts in every report. The record itself is not changed.</p>
          <input type="hidden" name="key" value={entry.key} />
          <label htmlFor="acc">Account</label>
          <select id="acc" name="account_id" defaultValue={chosen ?? ""}><option value="">Use the standard account for this {kindOfSource === "income" ? "income" : "category"}</option>{target.map((a) => <option key={a.id} value={a.id}>{a.number} {a.label}</option>)}</select>
          <p><SubmitButton>Save</SubmitButton></p></form>
      )}
      {manual && (
        <form action={reverse} className="card"><h2>Correct this entry</h2>
          <p className="muted">Entries are never edited or deleted. To fix one, post its reversal, then enter the right entry.</p>
          {manual.kind === "reversal" ? <p className="muted">This is a reversal and cannot itself be reversed.</p> : reversed ? <p className="muted">Already reversed.</p> : (<>
            <input type="hidden" name="key" value={entry.key} /><label htmlFor="rd">Reversal date</label><input id="rd" type="date" name="date" defaultValue={todayInChicago()} />
            <p><SubmitButton>Post reversal</SubmitButton></p></>)}
        </form>
      )}
    </>
  );
}
