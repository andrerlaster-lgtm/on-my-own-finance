import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, schemaVersion, listAppointments, listServices } from "@/lib/db";
import { addDays, parseDate, todayInChicago } from "@/lib/dates";
import { dayBounds, dayLabel, groupByDate, openOnly, weekDates, weekStart } from "@/lib/schedule";
import { expectedRevenue } from "@/lib/finance";
import { formatCents } from "@/lib/money";
import { AppointmentRow } from "@/components/AppointmentRow";
import { SecretaryNav } from "@/components/SecretaryNav";

export const dynamic = "force-dynamic";

export default async function SecretaryWeek({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  if (((await schemaVersion()) ?? 0) < 11) redirect("/secretary");
  const sp = await searchParams;
  const today = todayInChicago(), date = parseDate(sp.date) ?? today;
  const days = weekDates(date), from = dayBounds(days[0]).from, to = dayBounds(days[6]).to;
  const [list, services] = await Promise.all([listAppointments(from, to), listServices()]);
  const label = (code: string) => services.find((s) => s.code === code)?.label ?? code;
  const byDay = groupByDate(openOnly(list));
  return (
    <main>
      <h1>Secretary</h1>
      <SecretaryNav date={date} active="week" />
      <div className="card row">
        <Link className="btn secondary" href={`/secretary/week?date=${addDays(weekStart(date), -7)}`}>← Previous week</Link>
        <Link className="btn secondary" href={`/secretary/week?date=${today}`}>This week</Link>
        <Link className="btn secondary" href={`/secretary/week?date=${addDays(weekStart(date), 7)}`}>Next week →</Link>
      </div>
      <p className="muted">Week of {dayLabel(days[0])} to {dayLabel(days[6])}. Central time. {openOnly(list).length} appointment{openOnly(list).length === 1 ? "" : "s"}.{expectedRevenue(list) > 0 ? ` Expected revenue this week (not yet received): ${formatCents(expectedRevenue(list))}.` : ""}</p>
      <div className="week">
        {days.map((d) => { const items = byDay.get(d) ?? []; return (
          <div className="card" key={d}>
            <h2><Link href={`/secretary?date=${d}`}>{dayLabel(d)}</Link>{d === today ? " (today)" : ""}</h2>
            {items.length === 0 ? <p className="muted">Free</p> : <ul className="entries">{items.map((a) => <AppointmentRow key={a.id} a={a} serviceLabel={label(a.service_code)} compact day={d} />)}</ul>}
          </div>); })}
      </div>
    </main>
  );
}
