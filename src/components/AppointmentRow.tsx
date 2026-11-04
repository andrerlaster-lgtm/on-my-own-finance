import Link from "next/link";
import { STATUS_LABELS, TYPE_LABELS, clock, continuation, dayLabel, startLabel, toLocal, type Appointment } from "@/lib/schedule";

/**
 * One appointment as a list row. No names or contact details exist to show: only start time, type, service and status (the length is never shown).
 * Pass `day` (a Chicago date) when listing a single day: an appointment that crosses midnight is then marked as continuing from or into the neighbouring day.
 */
export function AppointmentRow({ a, serviceLabel, compact = false, day }: { a: Appointment; serviceLabel: string; compact?: boolean; day?: string }) {
  const s = toLocal(a.starts_at);
  const c = day ? continuation(a, day) : { fromPrev: false, toNext: false };
  const when = c.fromPrev ? `From ${dayLabel(s.date)}` : clock(s.time);
  const note = c.fromPrev ? "continues from the day before" : c.toNext ? "continues past midnight" : "";
  return (
    <li className={`entry appt appt-${a.status}`}>
      <span className="what"><Link href={`/secretary/${a.id}`}>{compact ? `${when} ` : `${when} · `}{serviceLabel}</Link></span>
      <span className={`pill pill-${a.status}`}>{STATUS_LABELS[a.status]}</span>
      <span className="meta">{compact ? `${TYPE_LABELS[a.type]}${note ? ` · ${note}` : ""}` : `${startLabel(a)} · ${TYPE_LABELS[a.type]} · #${a.id}${note ? ` · ${note}` : ""}`}</span>
    </li>
  );
}
