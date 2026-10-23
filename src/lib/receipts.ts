/*
 * Receipt photos are stored as JPEG only. The browser re-encodes the photo (which drops location and camera data); the server checks it
 * again and refuses anything that is not a plain JPEG or that still carries metadata (EXIF/XMP, IPTC, comments). Pure: no network, no files.
 */
export const MAX_RECEIPT_BYTES = 1_500_000;
export const MAX_RECEIPTS_PER_EXPENSE = 5;
const MAX_SIDE = 6000;

export type JpegCheck = { ok: true; width: number; height: number } | { ok: false; error: string };

export function inspectJpeg(b: Uint8Array): JpegCheck {
  const bad = (error: string): JpegCheck => ({ ok: false, error });
  if (b.length < 4 || b.length > MAX_RECEIPT_BYTES) return bad("The photo must be a JPEG under 1.5 MB.");
  if (b[0] !== 0xff || b[1] !== 0xd8) return bad("That is not a JPEG photo.");
  if (b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return bad("The photo file looks cut off. Try again.");
  let i = 2, w = 0, h = 0;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return bad("The photo could not be read.");
    while (b[i + 1] === 0xff) i++;
    const m = b[i + 1];
    if (m === 0xd9) return bad("The photo could not be read.");
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return bad("The photo could not be read.");
    if (m === 0xe1 || m === 0xed || m === 0xfe) return bad("The photo carries hidden details (location or camera data). Choose it again from the app so it is cleaned first.");
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { h = (b[i + 5] << 8) | b[i + 6]; w = (b[i + 7] << 8) | b[i + 8]; }
    if (m === 0xda) break;
    i += 2 + len;
  }
  if (!w || !h) return bad("The photo could not be read.");
  if (w > MAX_SIDE || h > MAX_SIDE) return bad("The photo is too large in pixels.");
  return { ok: true, width: w, height: h };
}
