import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, getRules, listTripsAll } from "@/lib/db";
import type { MileageData } from "@/lib/reports";
import type { RateInfo } from "@/lib/mileage";
import { loadLedgerInput } from "@/lib/accountingDb";
import { buildLedger } from "@/lib/ledger";

/** Every accounting page starts here: owner only, database ready, and the ledger calculated fresh from the records. */
export async function loadBooks() {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const input = await loadLedgerInput();
  return { input, accounts: input.accounts, ledger: buildLedger(input) };
}

export const flatParams = (sp: Record<string, string | string[] | undefined>): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));

/** The mileage log and the standard mileage rate for every tax year that has trips (plus this one). Mileage reports are built from these, not from the ledger. */
export async function loadMileageData(today: string): Promise<MileageData> {
  const trips = await listTripsAll("2000-01-01", "2100-12-31");
  const years = [...new Set([...trips.map((t) => Number(t.driven_on.slice(0, 4))), Number(today.slice(0, 4))])];
  const rules = await Promise.all(years.map((y) => getRules(y)));
  const rates: Record<number, RateInfo> = {};
  years.forEach((y, i) => { const r = rules[i]; rates[y] = { centsPerMile: r.mileage_rate_cents, confirmed: r.mileage_rate_confirmed, h2CentsPerMile: r.mileage_rate_h2_cents, h2Confirmed: r.mileage_rate_h2_confirmed }; });
  return { trips, rates };
}
