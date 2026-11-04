import { ownerOrNull } from "@/lib/auth";
import { databaseReady, listItems, listMovements } from "@/lib/db";
import { inventoryReport } from "@/lib/lots";
import { toCsv } from "@/lib/csv";
import { todayInChicago } from "@/lib/dates";

export const dynamic = "force-dynamic";
const none = (body: string, status: number) => new Response(body, { status, headers: { "Cache-Control": "no-store" } });

/** GET /api/inventory-report?year=2026 -> one CSV row per item (dollar columns in whole cents). Owner only. */
export async function GET(req: Request) {
  if (!(await ownerOrNull())) return none("Not signed in", 401);
  if (!(await databaseReady())) return none("Database is not set up yet", 409);
  const raw = new URL(req.url).searchParams.get("year") ?? "";
  const year = /^\d{4}$/.test(raw) && Number(raw) >= 2000 && Number(raw) <= 2100 ? Number(raw) : Number(todayInChicago().slice(0, 4));
  const rep = inventoryReport(await listItems(), await listMovements(), `${year}-01-01`, `${year}-12-31`);
  const cols = ["label", "unit", "begin_qty", "begin_value_cents", "opening_qty", "opening_value_cents", "purchase_qty", "purchase_value_cents", "use_qty", "use_value_cents", "writeoff_expired_qty", "writeoff_expired_value_cents", "adjust_down_qty", "adjust_down_value_cents", "adjust_up_qty", "adjust_up_value_cents", "end_qty", "end_value_cents"];
  const line = (r: (typeof rep.rows)[number]) => ({ label: r.label, unit: r.unit, begin_qty: r.beginQty, begin_value_cents: r.beginValue, opening_qty: r.openingQty, opening_value_cents: r.openingValue, purchase_qty: r.purchaseQty, purchase_value_cents: r.purchaseValue, use_qty: r.useQty, use_value_cents: r.useValue, writeoff_expired_qty: r.writeOffQty, writeoff_expired_value_cents: r.writeOffValue, adjust_down_qty: r.adjDownQty, adjust_down_value_cents: r.adjDownValue, adjust_up_qty: r.adjUpQty, adjust_up_value_cents: r.adjUpValue, end_qty: r.endQty, end_value_cents: r.endValue });
  const body = toCsv(cols, [...rep.rows.map(line), line({ ...rep.totals, label: "TOTAL" })]);
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="on-my-own-finance-inventory-${year}.csv"`, "Cache-Control": "no-store" } });
}
