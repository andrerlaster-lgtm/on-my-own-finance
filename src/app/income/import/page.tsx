import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, existingSquareIds, importSquareRows } from "@/lib/db";
import { buildPreview, parsePayload, parseSquareCsv, serializePayload } from "@/lib/squareImport";
import { LIMITS } from "@/lib/squareFormat";
import { ImportForm, type PreviewState } from "@/components/ImportForm";

export const dynamic = "force-dynamic";

async function previewAction(_prev: PreviewState, fd: FormData): Promise<PreviewState> {
  "use server";
  await requireOwner();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > LIMITS.fileBytes) return { error: "That file is too large (2 MB limit). Export a shorter date range." };
  const out = parseSquareCsv(await file.text());
  if (!out.ok) return { error: out.error };
  const existing = await existingSquareIds(out.rows.map((r) => r.external_id));
  return { preview: buildPreview(out, existing), payload: serializePayload(out.rows, out.counts) };
}

async function confirmAction(fd: FormData) {
  "use server";
  await requireOwner();
  const parsed = parsePayload(String(fd.get("payload") ?? ""));
  if (!parsed.ok) redirect(`/income/import?error=${encodeURIComponent(parsed.error)}`);
  const r = await importSquareRows(parsed.rows, parsed.counts, fd.get("count_visits") === "on" ? 1 : 0);
  redirect(`/income/import?added=${r.added}&dupes=${r.duplicates}`);
}

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ added?: string; dupes?: string; error?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const sp = await searchParams;
  const done = /^\d{1,6}$/.test(sp.added ?? "") && /^\d{1,6}$/.test(sp.dupes ?? "");
  return (
    <main>
      <p><Link href="/income">← Income</Link></p>
      <h1>Import Square transactions</h1>
      <div className="note">Export Transactions as CSV from Square. Only dates, amounts, status and payment IDs are read. Names, descriptions, card details and every other column are ignored and never saved, and the file itself is not kept.</div>
      {done && <div className="note">Imported {sp.added} payment{sp.added === "1" ? "" : "s"}; skipped {sp.dupes} duplicate{sp.dupes === "1" ? "" : "s"}. <Link href="/">See the dashboard</Link>.</div>}
      {sp.error && <div className="card err">{sp.error}</div>}
      <ImportForm preview={previewAction} confirm={confirmAction} />
    </main>
  );
}
