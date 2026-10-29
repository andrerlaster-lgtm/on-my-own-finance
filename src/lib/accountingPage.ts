import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady } from "@/lib/db";
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
