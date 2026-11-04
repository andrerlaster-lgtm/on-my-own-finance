import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, schemaVersion, listAppointments, listServices } from "@/lib/db";
import { addDays, parseDate, todayInChicago } from "@/lib/dates";
import { dayBounds, dayLabel, openOnly } from "@/lib/schedule";
import { AppointmentRow } from "@/components/AppointmentRow";
import { SecretaryNav } from "@/components/SecretaryNav";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function SecretaryDay({ searchParams }: { searchParams: Promise<{ date?: string; saved?: string; error?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  if (((await schemaVersion()) ?? 0) < 9) return <main><h1>Secretary</h1><div className="note">The database needs a one-time update first. Press <b>Update</b> on the home page, then come back.</div><p><Link href="/">← Home</Link></p></main>;
  const sp = await searchParams;
  const today = todayInChicago(), date = parseDate(sp.date) ?? today;
  const b = dayBounds(date), hours = Math.round((b.to - b.from) / 3_600_000);
  const [list, services] = await Promise.all([listAppointments(b.from, b.to), listServices()]);
  const label = (code: string) => services.find((s) => s.code === code)?.label ?? code;
  const open = openOnly(list), canceled = list.filter((a) => a.status === "canceled");
  return (
    <main>
      <h1>Secretary</h1>
      <div className="note">Private calendar. Times are Central (Chicago). Appointments hold no names, phone numbers, addresses or medical details; keep it that way.</div>
      {sp.saved && <div className="note">Saved.</div>}
      {sp.error && <div className="card err">{sp.error}</div>}
      <SecretaryNav date={date} active="day" />
      <div className="card row">
        <Link className="btn secondary" href={`/secretary?date=${addDays(date, -1)}`}>← Previous day</Link>
        <Link className="btn secondary" href={`/secretary?date=${today}`}>Today</Link>
        <Link className="btn secondary" href={`/secretary?date=${addDays(date, 1)}`}>Next day →</Link>
        <form method="get" className="row"><label htmlFor="d" style={{ margin: 0 }}>Go to</label><input id="d" name="date" type="date" defaultValue={date} style={{ maxWidth: 160 }} /><SubmitButton className="btn secondary">Go</SubmitButton></form>
      </div>
      <div className="card">
        <h2>{dayLabel(date)}{date === today ? " (today)" : ""} <span className="muted">{open.length} appointment{open.length === 1 ? "" : "s"}</span></h2>
        {hours !== 24 && <p className="muted">Clocks change on this day, so it is {hours} hours long.</p>}
        {open.length === 0 ? <p className="muted">Nothing scheduled. <Link href={`/secretary/new?date=${date}`}>Add an appointment</Link></p> : <ul className="entries">{open.map((a) => <AppointmentRow key={a.id} a={a} serviceLabel={label(a.service_code)} />)}</ul>}
      </div>
      {canceled.length > 0 && <div className="card"><h2>Canceled <span className="muted">{canceled.length}</span></h2><ul className="entries">{canceled.map((a) => <AppointmentRow key={a.id} a={a} serviceLabel={label(a.service_code)} />)}</ul></div>}
    </main>
  );
}
