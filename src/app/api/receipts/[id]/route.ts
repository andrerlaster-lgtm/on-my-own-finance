import { ownerOrNull } from "@/lib/auth";
import { getReceiptBytes } from "@/lib/db";

export const dynamic = "force-dynamic";
const plain = (body: string, status: number) => new Response(body, { status, headers: { "Cache-Control": "no-store" } });

/** One receipt photo, owner only. Always served as an inline JPEG that cannot be sniffed as anything else. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await ownerOrNull())) return plain("Not signed in", 401);
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) return plain("Not found", 404);
  const bytes = await getReceiptBytes(Number(id));
  if (!bytes) return plain("Not found", 404);
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; img-src 'self'" } });
}
