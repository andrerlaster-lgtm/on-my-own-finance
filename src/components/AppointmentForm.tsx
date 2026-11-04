import { APPOINTMENT_TYPES, type Service } from "@/lib/schedule";
import { SubmitButton } from "@/components/SubmitButton";

export interface FormValues { date: string; time: string; type: string; service_code: string }

/** The add / edit form. Every field is a fixed choice, a date or a time: there is nowhere to type a name, a number or a note, and no length to pick. */
export function AppointmentForm({ action, services, values, submitLabel, hidden }: {
  action: (fd: FormData) => Promise<void>; services: readonly Service[]; values: FormValues; submitLabel: string; hidden?: Record<string, string | number>;
}) {
  return (
    <form action={action} className="card">
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label htmlFor="ad">Date</label><input id="ad" name="date" type="date" defaultValue={values.date} required />
      <label htmlFor="at">Start time (Central)</label><input id="at" name="time" type="time" step={300} defaultValue={values.time} required />
      <label htmlFor="ay">Type</label>
      <select id="ay" name="type" defaultValue={values.type}>{APPOINTMENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
      <label htmlFor="as">Service</label>
      <select id="as" name="service_code" defaultValue={values.service_code}>{services.filter((s) => s.active || s.code === values.service_code).map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}</select>
      <p className="muted">No names, phone numbers, addresses or medical details go in the calendar. The appointment is identified by its number.</p>
      <p><SubmitButton className="btn">{submitLabel}</SubmitButton></p>
    </form>
  );
}
