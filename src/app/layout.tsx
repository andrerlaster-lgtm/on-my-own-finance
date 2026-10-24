import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = { title: "On My Own Finance", description: "Private business finances", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection(); // render per request so the Content-Security-Policy nonce can be applied
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
