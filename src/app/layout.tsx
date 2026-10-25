import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { ownerOrNull } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = { title: "On My Own Finance", description: "Private business finances", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#faf6ee", colorScheme: "light" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection(); // render per request so the Content-Security-Policy nonce can be applied
  const owner = await ownerOrNull(); // the menu is only drawn for the signed-in owner; every page still checks on its own
  return (
    <html lang="en">
      <body>{owner ? <Nav /> : null}{children}</body>
    </html>
  );
}
