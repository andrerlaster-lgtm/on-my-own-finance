import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { databaseConfigured, databaseReady, schemaVersion, runSetup, listIncome, lastImportRefunds, listItems, listExpenses, listTrips, getRules } from "@/lib/db";
import { estimateProfit, summarizeExpenses } from "@/lib/expenses";
import { formatMiles, mileageSummary, type RateInfo } from "@/lib/mileage";
import { summarize, TAX_FORMS } from "@/lib/income";
import { isLowStock } from "@/lib/inventory";
import { formatCents } from "@/lib/money";
import { periodRanges, todayInChicago } from "@/lib/dates";
import { SCHEMA_VERSION } from "@/lib/schema";
import { Nav } from "@/components/Nav";
import { revalidatePath } from "next/cache";
import { SignOutButton } from "@/components/AuthButtons";

export const dynamic = "force-dynamic";

async function setupDatabase() {
  "use server";
  await requireOwner();
  if (!databaseConfigured()) return;
  await runSetup();
  revalidatePath("/");
}

export default async function Home() {
  const owner = await requireOwner();
  const configured = databaseConfigured();
  const ready = configured && (await databaseReady());
  const version = ready ? await schemaVersion() : null;
  const today = todayInChicago();
  const periods = periodRanges(today);
  const dash = ready && (version ?? 0) >= 2;
  const entries = dash ? await listIncome(periods.year.from < periods.week.from ? periods.year.from : periods.week.from, periods.year.to > periods.week.to ? periods.year.to : periods.week.to, 5000) : [];
  const refunds = dash ? await lastImportRefunds() : null;
  const low = dash ? (await listItems()).filter((i) => isLowStock(i.stock.onHand, i.reorder_level)) : [];
  const full = dash && (version ?? 0) >= 3;
  const wideFrom = periods.year.from < periods.week.from ? periods.year.from : periods.week.from;
  const wideTo = periods.year.to > periods.week.to ? periods.year.to : periods.week.to;
  const exps = full ? await listExpenses(wideFrom, wideTo, 5000) : [];
  const trips = full ? await listTrips(wideFrom, wideTo, 5000) : [];
  const rates: Record<number, RateInfo> = {};
  if (full) for (const y of new Set([wideFrom, wideTo].map((d) => Number(d.slice(0, 4))))) { const r = await getRules(y); rates[y] = { centsPerMile: r.mileage_rate_cents, confirmed: r.mileage_rate_confirmed }; }
  const cols = [["This week", periods.week], ["This month", periods.month], ["This year", periods.year]] as const;
  return (
    <main>
      <Nav />
      <h1>On My Own Finance</h1>
      <p className="muted">Signed in as {owner.name}{owner.via === "dev-bypass" ? " (local test mode)" : ""}.</p>
      <div className="note">Profit figures are estimates only. Tax numbers, tip treatment and sales-tax status are for your tax preparer to confirm.</div>
      <div className="card">
        <h2>Database</h2>
        {!configured && <p className="err">DATABASE_URL is not set. See docs/SETUP.md.</p>}
        {configured && !ready && (
          <form action={setupDatabase}>
            <p>Connected settings found, but the tables are not created yet.</p>
            <button className="btn" type="submit">Set up database</button>
          </form>
        )}
        {ready && <p>Ready (schema version {version ?? "?"}).</p>}
        {ready && (version ?? 0) < SCHEMA_VERSION && (
          <form action={setupDatabase}>
            <p>New tables are available (version {SCHEMA_VERSION}). Updating only adds tables; nothing is changed or removed.</p>
            <button className="btn" type="submit">Update database</button>
          </form>
        )}
      </div>
      {dash && (
        <>
          {low.length > 0 && <div className="card"><h2>Low stock</h2><ul className="plain">{low.map((i) => <li key={i.id}><Link href={`/inventory/${i.id}`}>{i.label}</Link>: {i.stock.onHand} {i.unit} left</li>)}</ul></div>}
          {cols.map(([title, range]) => {
            const t = summarize(entries, range);
            return (
              <div className="card" key={title}>
                <h2>{title} <span className="muted">{range.from} to {range.to}</span></h2>
                <div className="grid2">
                  <div className="stat">Visits (as entered)<b>{t.visits}</b></div>
                  <div className="stat">Revenue (excludes tips and refunds)<b>{formatCents(t.revenue)}</b></div>
                  <div className="stat">Tips<b>{formatCents(t.tips)}</b></div>
                  <div className="stat">Total receipts (revenue + tips)<b>{formatCents(t.receipts)}</b></div>
                  <div className="stat">Processing fees<b>{formatCents(t.fees)}</b></div>
                  <div className="stat">Net after processing fees, before expenses<b>{formatCents(t.netAfterFees)}</b></div>
                </div>
                {full && (() => {
                  const ex = summarizeExpenses(exps, range), profit = estimateProfit(t.netAfterFees, ex), mi = mileageSummary(trips, range, rates);
                  return (
                    <>
                      <div className="grid2" style={{ marginTop: 8 }}>
                        <div className="stat">Expenses ({ex.count})<b>{formatCents(ex.total)}</b></div>
                        <div className="stat">Estimated profit, before taxes and before the mileage deduction<b>{profit === null ? "no expenses entered" : formatCents(profit)}</b></div>
                        <div className="stat">Miles ({mi.trips} trip{mi.trips === 1 ? "" : "s"})<b>{formatMiles(mi.miles_tenths)}</b></div>
                        <div className="stat">Mileage deduction estimate<b>{mi.ratesMissing ? "rate not set" : formatCents(mi.deductionCents)}</b></div>
                      </div>
                      {(profit === null || mi.unconfirmed) && <p className="muted">{profit === null ? "Profit is only estimated once this period has at least one expense entry. " : ""}{mi.unconfirmed ? "The mileage rate is not confirmed with your preparer." : ""}</p>}
                    </>
                  );
                })()}
                <p className="muted">Receipts by tax form: {TAX_FORMS.map((f) => `${f.label.split(" (")[0]} ${formatCents(t.byTaxForm[f.id].receipts)}`).join(" · ")}</p>
              </div>
            );
          })}
          {refunds && refunds.n > 0 && <div className="note">The last Square import ({refunds.first} to {refunds.last}) flagged {refunds.n} refund row{refunds.n === 1 ? "" : "s"} and left {refunds.n === 1 ? "it" : "them"} out. Revenue totals exclude refunds, so they may be higher than Square&rsquo;s net.</div>}
        </>
      )}
      {ready && (
        <>
          <div className="card">
            <h2>Tax-year rules</h2>
            <p className="muted">Mileage rate, set-aside, 1099-K and 1099-NEC thresholds, sales tax. Nothing is assumed.</p>
            <Link className="btn" href="/settings">Open settings</Link>
          </div>
          <div className="card">
            <h2>Backup export</h2>
            <p className="muted">Download your data. Restore planning is in docs/BACKUPS.md.</p>
            <div className="row">
              <a className="btn secondary" href="/api/export">All data (JSON)</a>
              <a className="btn secondary" href="/api/export?table=tax_year_rules">Tax rules (CSV)</a>
            </div>
          </div>
        </>
      )}
      <SignOutButton />
    </main>
  );
}
