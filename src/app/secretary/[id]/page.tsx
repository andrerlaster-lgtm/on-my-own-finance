import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, schemaVersion, listServices, getAppointment, updateAppointment, setAppointmentStatus } from "@/lib/db";
import { CANCEL_REASONS, CANCEL_REASON_LABELS, STATUS_LABELS, TYPE_LABELS, allowedNext, checkTransition, dayLabel, isEditable, isStatus, minutesOf, parseAppointmentForm, parseCancelReason, rangeLabel, toLocal } from "@/lib/schedule";
import { AppointmentForm } from "@/components/AppointmentForm";
import { SecretaryNav } from "@/components/SecretaryNav";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";
const idOf = (fd: FormData) => (/^\d{1,12}$/.test(String(fd.get("id") ?? "")) ? Number(fd.get("id")) : 0);
const back = (id: number, q: string): never => redirect(`/secretary/${id}?${q}`);

async function save(fd: FormData) {
  "use server";
  await requireOwner();
  const id = idOf(fd);
  const raw: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") raw[k] = v;
  const parsed = parseAppointmentForm(raw, await listServices());
  if (!parsed.ok) return back(id, `error=${encodeURIComponent(parsed.errors.join(" | "))}`);
  const r = await updateAppointment(id, parsed.value);
  if (!r.ok) return back(id, `error=${encodeURIComponent(r.error)}`);
  back(id, "saved=1");
}

async function changeStatus(fd: FormData) {
  "use server";
  await requireOwner();
  const id = idOf(fd), to = String(fd.get("to") ?? "");
  const current = id ? await getAppointment(id) : null;
  if (!current || !isStatus(to)) return back(id, `error=${encodeURIComponent("Appointment not found.")}`);
  const problem = checkTransition(current.status, to, current.starts_at, Date.now());
  if (problem) return back(id, `error=${encodeURIComponent(problem)}`);
  const reason = to === "canceled" ? parseCancelReason(String(fd.get("reason") ?? "")) : null;
  if (to === "canceled" && !reason) return back(id, `error=${encodeURIComponent("Choose a reason for canceling.")}`);
  const r = await setAppointmentStatus(id, current.status, to, reason);
  if (!r.ok) return back(id, `error=${encodeURIComponent(r.error)}`);
  back(id, "saved=1");
}

export default async function AppointmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  if (((await schemaVersion()) ?? 0) < 9) redirect("/secretary");
  const { id: rawId } = await params;
  if (!/^\d{1,12}$/.test(rawId)) notFound();
  const [a, services, sp] = await Promise.all([getAppointment(Number(rawId)), listServices(), searchParams]);
  if (!a) notFound();
  const s = toLocal(a.starts_at);
  const label = services.find((x) => x.code === a.service_code)?.label ?? a.service_code;
  const moves = allowedNext(a.status);
  return (
    <main>
      <h1>Appointment #{a.id}</h1>
      <SecretaryNav date={s.date} active="day" />
      {sp.saved && <div className="note">Saved.</div>}
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      <div className="card">
        <h2>{label} <span className="muted">{STATUS_LABELS[a.status]}</span></h2>
        <p>{dayLabel(s.date)}, {rangeLabel(a)}<br /><span className="muted">{TYPE_LABELS[a.type]} · {minutesOf(a)} minutes{a.cancel_reason ? ` · canceled: ${CANCEL_REASON_LABELS[a.cancel_reason]}` : ""}{a.source !== "internal" ? ` · from the ${a.source}` : ""}</span></p>
        {moves.length > 0 && (
          <div className="row">
            {moves.filter((m) => m !== "canceled").map((m) => (
              <form key={m} action={changeStatus} className="inline"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="to" value={m} /><SubmitButton className="btn secondary">{a.status === "canceled" ? "Reinstate as scheduled" : `Mark ${STATUS_LABELS[m].toLowerCase()}`}</SubmitButton></form>
            ))}
          </div>
        )}
        {moves.includes("canceled") && (
          <form action={changeStatus}>
            <input type="hidden" name="id" value={a.id} /><input type="hidden" name="to" value="canceled" />
            <label htmlFor="cr">Cancel this appointment. Reason:</label>
            <select id="cr" name="reason" defaultValue="requested">{CANCEL_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
            <p><SubmitButton className="btn secondary">Cancel appointment</SubmitButton></p>
          </form>
        )}
        {a.status === "completed" && <p className="muted">Completed appointments are final. Completing one does not record any income or change any supplies; enter those yourself on their own pages.</p>}
      </div>
      {isEditable(a.status) && <>
        <h2>Change the time or details</h2>
        <AppointmentForm action={save} services={services} submitLabel="Save changes" hidden={{ id: a.id }} values={{ date: s.date, time: s.time, type: a.type, service_code: a.service_code, minutes: minutesOf(a) }} />
      </>}
      <p><Link href={`/secretary?date=${s.date}`}>← Back to the calendar</Link></p>
    </main>
  );
}
