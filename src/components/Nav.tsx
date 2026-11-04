"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { signOut } from "next-auth/react";

const I = (d: string) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const PRIMARY = [
  { href: "/", label: "Home", icon: I("M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z") },
  { href: "/income", label: "Income", icon: I("M12 3v12m0 0-4-4m4 4 4-4M4 21h16") },
  { href: "/expenses", label: "Expenses", icon: I("M12 21V9m0 0-4 4m4-4 4 4M4 3h16") },
  { href: "/inventory", label: "Supplies", icon: I("M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8") },
  { href: "/taxes", label: "Taxes", icon: I("M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6") },
];
const MORE = [{ href: "/accounting", label: "Accounting" }, { href: "/mileage", label: "Mileage" }, { href: "/settings", label: "Tax rules" }, { href: "/activity", label: "Activity" }];

const here = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

/** Top bar on a computer, tab bar on a phone. Shown only after sign-in (the layout checks). */
export function Nav() {
  const path = usePathname() ?? "/";
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => { menu.current?.removeAttribute("open"); }, [path]);
  const current = (href: string) => (here(path, href) ? ("page" as const) : undefined);
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand" aria-label="On My Own Finance, home">
            <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#2f6b58" /><path d="M9 21c0-6 4-10 14-10 0 8-4 12-10 12-1.6 0-3-.5-4-2z" fill="#faf6ee" /><path d="M9 24c3-6 6-8 10-10" stroke="#2f6b58" strokeWidth="1.6" fill="none" strokeLinecap="round" /></svg>
            On My Own Finance
          </Link>
          <nav className="desk-links" aria-label="Main">
            {[...PRIMARY, ...MORE].map((l) => <Link key={l.href} href={l.href} aria-current={current(l.href)}>{l.label}</Link>)}
            <button type="button" onClick={() => signOut({ callbackUrl: "/signin" })}>Sign out</button>
          </nav>
        </div>
      </header>
      <nav className="tabbar" aria-label="Quick links">
        {PRIMARY.map((l) => <Link key={l.href} href={l.href} aria-current={current(l.href)}>{l.icon}{l.label}</Link>)}
        <details className="more" ref={menu}>
          <summary aria-label="More">{I("M5 12h.01M12 12h.01M19 12h.01")}More</summary>
          <div className="more-menu">
            {MORE.map((l) => <Link key={l.href} href={l.href} aria-current={current(l.href)}>{l.label}</Link>)}
            <button type="button" onClick={() => signOut({ callbackUrl: "/signin" })}>Sign out</button>
          </div>
        </details>
      </nav>
    </>
  );
}
