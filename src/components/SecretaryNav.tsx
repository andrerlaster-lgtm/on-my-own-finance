import Link from "next/link";

/** Day / Week / New tabs for the Secretary pages, keeping the chosen date. Server component. */
export function SecretaryNav({ date, active }: { date: string; active: "day" | "week" | "new" }) {
  const tab = (key: string, href: string, label: string) => <Link key={key} className={`btn ${active === key ? "" : "secondary"}`} href={href} aria-current={active === key ? "page" : undefined}>{label}</Link>;
  return (
    <div className="card row" role="navigation" aria-label="Secretary">
      {tab("day", `/secretary?date=${date}`, "Day")}
      {tab("week", `/secretary/week?date=${date}`, "Week")}
      {tab("new", `/secretary/new?date=${date}`, "New appointment")}
    </div>
  );
}
