import { ownerOrNull } from "@/lib/auth";
import { databaseReady } from "@/lib/db";
import { loadLedgerInput } from "@/lib/accountingDb";
import { loadMileageData } from "@/lib/accountingPage";
import { buildLedger } from "@/lib/ledger";
import { buildReport, MILEAGE_REPORT_IDS, REPORT_IDS } from "@/lib/reports";
import { reportToXlsx } from "@/lib/xlsx";
import { reportToPdf } from "@/lib/pdfdoc";
import { todayInChicago } from "@/lib/dates";

export const dynamic = "force-dynamic";
const text = (body: string, status: number) => new Response(body, { status, headers: { "Cache-Control": "no-store" } });

/** GET /api/accounting/export?report=income-statement&format=xlsx|pdf&period=month&y=2026&m=10 ... Owner only. Same parameters as the report page. */
export async function GET(req: Request) {
  if (!(await ownerOrNull())) return text("Not signed in", 401);
  if (!(await databaseReady())) return text("Database is not set up yet", 409);
  const q = new URL(req.url).searchParams;
  const id = q.get("report") ?? "", format = q.get("format");
  if (!REPORT_IDS.includes(id)) return text("Unknown report", 400);
  if (format !== "xlsx" && format !== "pdf") return text("Unknown format", 400);
  const params = Object.fromEntries(q.entries());
  const input = await loadLedgerInput(), today = todayInChicago();
  const doc = buildReport(id, buildLedger(input), input.accounts, params, today, MILEAGE_REPORT_IDS.includes(id) ? await loadMileageData(today) : undefined);
  if (!doc) return text("Unknown report", 400);
  const name = `on-my-own-finance-${id}-${(doc.subtitle || today).replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "")}`;
  const body = format === "xlsx" ? reportToXlsx(doc) : reportToPdf(doc, today);
  return new Response(body as BodyInit, { headers: { "Content-Type": format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf", "Content-Disposition": `attachment; filename="${name}.${format}"`, "Cache-Control": "no-store" } });
}
