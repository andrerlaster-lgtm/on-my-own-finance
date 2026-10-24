import { ownerOrNull } from "@/lib/auth";
import { databaseReady, exportTable, audit } from "@/lib/db";
import { EXPORT_TABLES, SCHEMA_VERSION, type ExportTable } from "@/lib/schema";
import { toCsv, type Cell } from "@/lib/csv";

export const dynamic = "force-dynamic";
const MAX_WEB_BYTES = 3_500_000; // Vercel rejects function responses over about 4.5 MB; stay well under
const tooBig = () => new Response("This export is too large for a web download. Run `npm run backup` on your computer for a complete backup (see docs/BACKUPS.md), or export one table at a time.", { status: 413, headers: { "Cache-Control": "no-store" } });
const headers = (type: string, name: string) => ({ "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" });

/** GET /api/export            -> everything as one JSON file
 *  GET /api/export?table=NAME  -> one table as CSV (injection-guarded for spreadsheets) */
export async function GET(req: Request) {
  const owner = await ownerOrNull();
  if (!owner) return new Response("Not signed in", { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!(await databaseReady())) return new Response("Database is not set up yet", { status: 409, headers: { "Cache-Control": "no-store" } });
  const stamp = new Date().toISOString().slice(0, 10);
  const table = new URL(req.url).searchParams.get("table");
  if (table) {
    if (!EXPORT_TABLES.includes(table as ExportTable)) return new Response("Unknown table", { status: 400, headers: { "Cache-Control": "no-store" } });
    const rows = await exportTable(table as ExportTable);
    const columns = rows.length ? Object.keys(rows[0]) : [];
    const flat = rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] !== null && typeof r[c] === "object" && !(r[c] instanceof Date) ? JSON.stringify(r[c]) : (r[c] as Cell)])));
    const body = toCsv(columns, flat);
    if (Buffer.byteLength(body) > MAX_WEB_BYTES) return tooBig();
    await audit("export_csv", { table });
    return new Response(body, { headers: headers("text/csv; charset=utf-8", `on-my-own-finance-${table}-${stamp}.csv`) });
  }
  const data: Record<string, unknown[]> = {};
  for (const t of EXPORT_TABLES) data[t] = await exportTable(t);
  const json = JSON.stringify({ app: "on-my-own-finance", schema_version: SCHEMA_VERSION, exported_at: new Date().toISOString(), tables: data }, null, 2);
  if (Buffer.byteLength(json) > MAX_WEB_BYTES) return tooBig();
  await audit("export_json", {});
  return new Response(json, {
    headers: headers("application/json; charset=utf-8", `on-my-own-finance-${stamp}.json`),
  });
}
