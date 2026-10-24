import Link from "next/link";

export function Nav() {
  return (
    <nav className="row" style={{ marginBottom: 12 }}>
      <Link href="/">Home</Link><Link href="/income">Income</Link><Link href="/expenses">Expenses</Link><Link href="/mileage">Mileage</Link><Link href="/inventory">Inventory</Link><Link href="/taxes">Taxes</Link><Link href="/settings">Tax rules</Link><Link href="/activity">Activity</Link>
    </nav>
  );
}
