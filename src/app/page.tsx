import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { databaseConfigured, databaseReady, schemaVersion, runSetup } from "@/lib/db";
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
  return (
    <main>
      <h1>On My Own Finance</h1>
      <p className="muted">Signed in as {owner.name}{owner.via === "dev-bypass" ? " (local test mode)" : ""}.</p>
      <div className="note">Phase 0: setup only. No income, expenses, or profit figures yet. Tax numbers and sales-tax status are for your tax preparer to confirm.</div>
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
      </div>
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
