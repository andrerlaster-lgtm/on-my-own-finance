import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { loadBooks, flatParams } from "@/lib/accountingPage";
import { setMapping } from "@/lib/accountingDb";
import { buildReport } from "@/lib/reports";
import { inventoryReport } from "@/lib/lots";
import { resolvePeriod, fmtAmount } from "@/lib/statements";
import { todayInChicago } from "@/lib/dates";
import { PeriodForm } from "@/components/accounting/PeriodForm";
import { ReportView } from "@/components/accounting/ReportView";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

async function classify(fd: FormData) {
  "use server";
  await requireOwner();
  const item = String(fd.get("item_id") ?? ""), acct = String(fd.get("account_id") ?? "");
  if (/^\d{1,12}$/.test(item)) await setMapping("item", Number(item), /^\d{1,12}$/.test(acct) ? Number(acct) : null);
  redirect("/accounting/cost-of-services?saved=1");
}

export default async function CostOfServices({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = flatParams(await searchParams), today = todayInChicago();
  await requireOwner();
  const { accounts, ledger, input } = await loadBooks();
  const period = resolvePeriod(p, today);
  const doc = buildReport("cost-of-services", ledger, accounts, p, today);
  const inv = inventoryReport(input.items.map((i) => ({ id: i.id, label: i.label, unit: "" })), input.movements, period.range.from, period.range.to);
  const cos = accounts.filter((a) => a.type === "cost_of_services" && a.active);
  const t = inv.totals;
  return (
    <>
      <div className="note">Buying supplies is not an expense: it adds to Inventory (an asset). Using supplies is the cost of services. Each item below is expensed to “Medical supplies consumed” unless you pick another cost account.</div>
      {p.saved && <div className="note">Saved.</div>}
      <PeriodForm action="/accounting/cost-of-services" p={p} today={today} compare />
      {doc && <ReportView doc={doc} />}
      <div className="card"><h2>Inventory roll-forward <span className="muted">{period.label}</span></h2>
        <div className="tablewrap"><table className="stmt"><thead><tr><th>Item</th><th className="num">Beginning</th><th className="num">Purchases</th><th className="num">Used (cost)</th><th className="num">Adjustments</th><th className="num">Ending</th></tr></thead>
          <tbody>{inv.rows.map((r) => <tr key={r.item_id}><td>{r.label}</td><td className="num">{fmtAmount(r.beginValue)}</td><td className="num">{fmtAmount(r.purchaseValue + r.openingValue)}</td><td className="num">{fmtAmount(-r.useValue)}</td><td className="num">{fmtAmount(r.adjUpValue - r.adjDownValue - r.writeOffValue)}</td><td className="num">{fmtAmount(r.endValue)}</td></tr>)}</tbody>
          <tfoot><tr><th>Total</th><td className="num">{fmtAmount(t.beginValue)}</td><td className="num">{fmtAmount(t.purchaseValue + t.openingValue)}</td><td className="num">{fmtAmount(-t.useValue)}</td><td className="num">{fmtAmount(t.adjUpValue - t.adjDownValue - t.writeOffValue)}</td><td className="num">{fmtAmount(t.endValue)}</td></tr></tfoot></table></div>
        {inv.problems.length > 0 && <ul className="muted">{inv.problems.map((x) => <li key={x}>{x}</li>)}</ul>}
      </div>
      <div className="card"><h2>Cost account for each supply item</h2>
        <ul className="entries">{input.items.map((it) => <li className="entry" key={it.id}><span className="what">{it.label}</span>
          <form action={classify} className="acts"><input type="hidden" name="item_id" value={it.id} />
            <select name="account_id" defaultValue={input.itemAccounts?.[it.id] ?? ""} aria-label={`Cost account for ${it.label}`}><option value="">Medical supplies consumed (standard)</option>{cos.filter((a) => a.system_key !== "supplies_consumed").map((a) => <option key={a.id} value={a.id}>{a.number} {a.label}</option>)}</select>
            <SubmitButton className="btn secondary">Save</SubmitButton></form></li>)}
          {input.items.length === 0 && <li className="muted">No supply items yet.</li>}</ul>
      </div>
    </>
  );
}
