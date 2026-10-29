"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/accounting", label: "Dashboard" },
  { href: "/accounting/transactions", label: "Transactions" },
  { href: "/accounting/accounts", label: "Chart of Accounts" },
  { href: "/accounting/ledger", label: "General Ledger" },
  { href: "/accounting/cost-of-services", label: "Inventory & Cost of Services" },
  { href: "/accounting/reports", label: "Financial Reports" },
  { href: "/accounting/tools", label: "Accounting Tools" },
];

export function AcctTabs() {
  const path = usePathname() ?? "";
  return (
    <nav className="acct-tabs" aria-label="Accounting">
      {TABS.map((t) => <Link key={t.href} href={t.href} aria-current={(t.href === "/accounting" ? path === t.href : path.startsWith(t.href)) ? "page" : undefined}>{t.label}</Link>)}
    </nav>
  );
}
