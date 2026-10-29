import { ownerOrNull } from "@/lib/auth";
import { cleanCity, cleanStreet } from "@/lib/mileage";
import { estimateDrivingMiles, MESSAGES } from "@/lib/routing";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/**
 * GET /api/mileage/estimate?from=Abilene,%20TX&to=Dallas,%20TX[&fromStreet=...&toStreet=...]  Owner only.
 * Returns the one-way road distance in tenths of a mile. The routing key (ORS_API_KEY) stays on the server; nothing here is stored or logged.
 */
export async function GET(req: Request) {
  if (!(await ownerOrNull())) return json({ ok: false, reason: "unauthorized", message: "Not signed in" }, 401);
  const q = new URL(req.url).searchParams;
  const from = cleanCity(q.get("from") ?? ""), to = cleanCity(q.get("to") ?? "");
  const fromStreet = cleanStreet(q.get("fromStreet") ?? ""), toStreet = cleanStreet(q.get("toStreet") ?? "");
  if (!from || !to || fromStreet === null || toStreet === null) return json({ ok: false, reason: "invalid", message: "Enter a city for the start and the destination, like Abilene, TX. Street addresses go in the optional street boxes." }, 400);
  const r = await estimateDrivingMiles({ from, to, fromStreet: fromStreet || undefined, toStreet: toStreet || undefined }, process.env.ORS_API_KEY, (url, init) => fetch(url, init));
  if (!r.ok) return json({ ok: false, reason: r.reason, message: MESSAGES[r.reason] }, r.reason === "no_key" ? 503 : 200);
  return json({ ok: true, oneWayTenths: r.oneWayTenths, source: r.source });
}
