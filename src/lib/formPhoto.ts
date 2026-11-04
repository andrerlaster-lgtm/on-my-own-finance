import { MAX_RECEIPT_BYTES, inspectJpeg } from "./receipts";

/** null = no photo chosen. Otherwise the server re-checks the photo itself: plain JPEG, small, no hidden metadata. */
export async function readPhoto(fd: FormData): Promise<null | { bytes: Uint8Array } | { error: string }> {
  const f = fd.get("receipt");
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > MAX_RECEIPT_BYTES) return { error: "The photo is larger than 1.5 MB." };
  const bytes = new Uint8Array(await f.arrayBuffer());
  const c = inspectJpeg(bytes);
  return c.ok ? { bytes } : { error: c.error };
}
