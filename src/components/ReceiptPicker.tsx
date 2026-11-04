"use client";
import { useRef, useState } from "react";

const MAX_SIDE = 1600, TARGET = 900_000;

/** Shrinks the chosen photo and re-encodes it as a plain JPEG in the browser. Re-encoding drops location and camera data. */
async function clean(file: File): Promise<File> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  let q = 0.8, blob: Blob | null = null;
  for (let i = 0; i < 5; i++) {
    blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= TARGET) break;
    q -= 0.12;
  }
  if (!blob) throw new Error("encode");
  return new File([blob], "receipt.jpg", { type: "image/jpeg" });
}

export function ReceiptPicker({ name = "receipt" }: { name?: string }) {
  const out = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!out.current) return;
    if (!f) { out.current.value = ""; setMsg(""); return; }
    try {
      const small = await clean(f);
      const dt = new DataTransfer(); dt.items.add(small);
      out.current.files = dt.files;
      setMsg(`Photo ready (${Math.round(small.size / 1024)} KB, location data removed).`);
    } catch {
      out.current.value = ""; setMsg("That photo could not be read. Try another one.");
    }
  }
  return (
    <>
      <input type="file" accept="image/*" onChange={onPick} aria-label="Receipt photo" />
      <input ref={out} type="file" name={name} hidden />
      <div className="muted">{msg || "Optional. Make sure no card number or patient information is visible."}</div>
    </>
  );
}
