import { ownerOrNull } from "@/lib/auth";
import { databaseReady, getSnapshot, loadPacketInput } from "@/lib/db";
import { PACKET_SECTIONS, buildPacket, packetCsv, type PacketSection } from "@/lib/packet";
import { todayInChicago } from "@/lib/dates";
import { parseYear } from "@/lib/taxRules";

export const dynamic = "force-dynamic";
const text = (body: string, status: number) => new Response(body, { status, headers: { "Cache-Control": "no-store" } });

/** GET /api/tax-packet?year=2026&section=receipts -> one CSV section.   GET /api/tax-packet?snapshot=3 -> a saved snapshot as JSON. Owner only. */
export async function GET(req: Request) {
  if (!(await ownerOrNull())) return text("Not signed in", 401);
  if (!(await databaseReady())) return text("Database is not set up yet", 409);
  const q = new URL(req.url).searchParams;
  const snap = q.get("snapshot");
  if (snap !== null) {
    if (!/^\d{1,12}$/.test(snap)) return text("Not found", 404);
    const packet = await getSnapshot(Number(snap));
    if (!packet) return text("Not found", 404);
    return new Response(JSON.stringify(packet, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="on-my-own-finance-tax-snapshot-${snap}.json"`, "Cache-Control": "no-store" } });
  }
  const year = parseYear(q.get("year") ?? "") ?? Number(todayInChicago().slice(0, 4));
  const section = q.get("section") as PacketSection;
  if (!PACKET_SECTIONS.includes(section)) return text("Unknown section", 400);
  const body = packetCsv(buildPacket(await loadPacketInput(year, todayInChicago())), section);
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="on-my-own-finance-${year}-${section}.csv"`, "Cache-Control": "no-store" } });
}
