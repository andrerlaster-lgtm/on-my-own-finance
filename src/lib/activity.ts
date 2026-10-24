import { formatCents } from "./money";

/*
 * Plain-English lines for the activity log. The log stores only what happened and record numbers or amounts, never names, notes or card details.
 * Only fields known to be safe are shown; anything else in a record is ignored.
 */
const LABELS: Record<string, string> = {
  setup: "Database set up or updated", save_tax_rules: "Saved tax-year rules", export_json: "Downloaded the JSON export", export_csv: "Downloaded a CSV export",
  add_income: "Added income", delete_income: "Deleted an income entry", set_visits: "Changed an entry's visits", import_square: "Imported Square payments",
  add_item: "Added an inventory item", set_reorder_level: "Changed a reorder level", add_movement: "Recorded an inventory change", assign_past_uses: "Assigned past uses to lots",
  set_expiry_warning: "Changed an expiry warning", add_expense: "Added an expense", delete_expense: "Deleted an expense", add_receipt: "Added a receipt photo", delete_receipt: "Removed a receipt photo",
  add_trip: "Added a mileage trip", delete_trip: "Deleted a mileage trip", add_payer: "Added a payer", add_1099_form: "Entered a 1099 form amount", delete_1099_form: "Deleted a 1099 form amount",
  add_tax_payment: "Recorded a tax payment", delete_tax_payment: "Deleted a tax payment", bulk_set_tax_form: "Set the tax form on Square entries", save_tax_snapshot: "Saved a tax snapshot",
  signin_allowed: "Signed in", signin_refused: "Sign-in refused",
};
const SHOW = ["id", "item_id", "batch", "year", "tax_year", "kind", "category", "form", "rows", "added", "duplicates", "skipped", "quantity", "lots", "table", "occurred_on", "source", "days", "level", "visits"];
const MONEY = ["amount_cents"];

export function describeActivity(action: string, detail: unknown): { label: string; facts: string } {
  const d = (typeof detail === "string" ? safeParse(detail) : detail) as Record<string, unknown> | null;
  const parts: string[] = [];
  if (d && typeof d === "object") {
    for (const k of SHOW) { const v = d[k]; if ((typeof v === "number" || (typeof v === "string" && /^[A-Za-z0-9_ -]{1,30}$/.test(v)))) parts.push(`${k.replace(/_/g, " ")} ${v}`); }
    for (const k of MONEY) { const v = d[k]; if (typeof v === "number") parts.push(`amount ${formatCents(v)}`); }
  }
  return { label: LABELS[action] ?? action.replace(/_/g, " "), facts: parts.join(" · ") };
}
function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }
