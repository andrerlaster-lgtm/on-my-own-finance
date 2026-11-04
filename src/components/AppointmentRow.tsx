import Link from "next/link";
import { STATUS_LABELS, TYPE_LABELS, rangeLabel, toLocal, clock, minutesOf, type Appointment } from "@/lib/schedule";

/** One appointment as a list row. No names or contact details exist to show: only time, type, service and status. */
export function AppointmentRow({ a, serviceLabel, compact = false }: { a: Appointment; serviceLabel: string; compact?: boolean }) {
  const s = toLocal(a.starts_at);
  return (
    <li className={`entry appt appt-${a.status}`}>
      <span className="what"><Link href={`/secretary/${a.id}`}>{compact ? `${clock(s.time)} ` : ""}{compact ? "" : `${clock(s.time)} · `}{serviceLabel}</Link></span>
      <span className={`pill pill-${a.status}`}>{STATUS_LABELS[a.status]}</span>
      <span className="meta">{compact ? `${TYPE_LABELS[a.type]} · ${minutesOf(a)} min` : `${rangeLabel(a)} · ${TYPE_LABELS[a.type]} · ${minutesOf(a)} min · #${a.id}`}</span>
    </li>
  );
}
