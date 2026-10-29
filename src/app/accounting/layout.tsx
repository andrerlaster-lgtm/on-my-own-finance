import { AcctTabs } from "@/components/accounting/AcctTabs";

export default function AccountingLayout({ children }: { children: React.ReactNode }) {
  return <main className="acct"><h1>Accounting</h1><AcctTabs />{children}</main>;
}
