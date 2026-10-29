import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { loadBooks, flatParams } from "@/lib/accountingPage";
import { accountHasHistory, saveAccount, setAccountActive, setMapping } from "@/lib/accountingDb";
import { TYPE_INFO, TYPE_ORDER, deactivateProblem, type AccountType } from "@/lib/accounts";
import { CATEGORIES } from "@/lib/expenses";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";
const go = (q: string) => redirect(`/accounting/accounts${q}`);
const raw = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;

async function save(fd: FormData) {
  "use server";
  await requireOwner();
  const f = raw(fd), id = /^\d{1,12}$/.test(f.id ?? "") ? Number(f.id) : undefined;
  const r = await saveAccount(f, id);
  go(r.ok ? "?saved=1" : `?error=${encodeURIComponent(r.errors.join(" | "))}`);
}
async function toggle(fd: FormData) {
  "use server";
  await requireOwner();
  const id = Number(fd.get("id")), err = Number.isInteger(id) ? await setAccountActive(id, fd.get("active") === "1") : "Not found.";
  go(err ? `?error=${encodeURIComponent(err)}` : "?saved=1");
}
async function mapCategory(fd: FormData) {
  "use server";
  await requireOwner();
  const cat = String(fd.get("category") ?? ""), acct = /^\d{1,12}$/.test(String(fd.get("account_id") ?? "")) ? Number(fd.get("account_id")) : null;
  if (CATEGORIES.some((c) => c.id === cat)) await setMapping("category", cat, acct);
  go("?saved=1");
}

export default async function Accounts({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = flatParams(await searchParams);
  await requireOwner();
  const { accounts, input } = await loadBooks();
  const used = new Map<number, boolean>(await Promise.all(accounts.map(async (a) => [a.id, await accountHasHistory(a.id)] as const)));
  const expenseAccts = accounts.filter((a) => (a.type === "operating_expense" || a.type === "cost_of_services") && a.active);
  const defaultFor = (cat: string) => accounts.find((a) => a.system_key === `cat:${cat}`);
  return (
    <>
      <div className="note">Accounts are never deleted. An account with history can be made inactive, which only hides it from pickers; every past entry keeps pointing at it.</div>
      {p.saved && <div className="note">Saved.</div>}
      {p.error && <div className="card err">{p.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      {TYPE_ORDER.map((t: AccountType) => (
        <div className="card" key={t}>
          <h2>{TYPE_INFO[t].plural} <span className="muted">{TYPE_INFO[t].min}–{TYPE_INFO[t].max}</span></h2>
          <ul className="entries">
            {accounts.filter((a) => a.type === t).map((a) => (
              <li className="entry" key={a.id}>
                <span className="what">{a.number} {a.label}{a.active ? "" : " (inactive)"}</span>
                <span className="meta">{a.normal === "debit" ? "Debit" : "Credit"} normal{a.system_key ? " · used by automatic postings" : ""}{used.get(a.id) ? " · has activity" : ""}</span>
                <div className="acts">
                  <details className="mini"><summary>Edit</summary>
                    <form action={save}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="type" value={a.type} />
                      <label>Number<input name="number" defaultValue={a.number} inputMode="numeric" maxLength={4} /></label>
                      <label>Name<input name="label" defaultValue={a.label} maxLength={60} /></label>
                      {t === "other" && <label>Side<select name="normal" defaultValue={a.normal}><option value="credit">Income (credit)</option><option value="debit">Expense (debit)</option></select></label>}
                      <SubmitButton className="btn secondary">Save</SubmitButton></form>
                  </details>
                  {(a.active ? !deactivateProblem(a) : true) && <form action={toggle} className="inline"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="active" value={a.active ? "0" : "1"} /><SubmitButton className="linkbtn">{a.active ? "Make inactive" : "Make active"}</SubmitButton></form>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <form action={save} className="card"><h2>Add an account</h2>
        <label htmlFor="at">Type</label><select id="at" name="type" defaultValue="operating_expense">{TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_INFO[t].label} ({TYPE_INFO[t].min}–{TYPE_INFO[t].max})</option>)}</select>
        <label htmlFor="an">Number (four digits)</label><input id="an" name="number" inputMode="numeric" maxLength={4} placeholder="6150" />
        <label htmlFor="al">Name</label><input id="al" name="label" maxLength={60} />
        <label htmlFor="as">For “Other income or expense” only</label><select id="as" name="normal" defaultValue="debit"><option value="debit">Expense (debit)</option><option value="credit">Income (credit)</option></select>
        <p><SubmitButton>Add account</SubmitButton></p></form>
      <div className="card"><h2>Expense categories → accounts</h2>
        <p className="muted">Each expense category posts to one account. Change a category here and every report moves with it. Single expenses can be re-pointed from their ledger entry.</p>
        <ul className="entries">{CATEGORIES.map((c) => { const mapped = input.categoryAccounts?.[c.id]; return (
          <li className="entry" key={c.id}><span className="what">{c.label}</span>
            <form action={mapCategory} className="acts"><input type="hidden" name="category" value={c.id} />
              <select name="account_id" defaultValue={mapped ?? ""} aria-label={`Account for ${c.label}`}><option value="">Standard: {defaultFor(c.id) ? `${defaultFor(c.id)!.number} ${defaultFor(c.id)!.label}` : "none"}</option>{expenseAccts.map((a) => <option key={a.id} value={a.id}>{a.number} {a.label}</option>)}</select>
              <SubmitButton className="btn secondary">Save</SubmitButton></form></li>); })}</ul>
      </div>
    </>
  );
}
