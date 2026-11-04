import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, schemaVersion, listServices, addAppointment } from "@/lib/db";
import { parseDate, todayInChicago } from "@/lib/dates";
import { parseAppointmentForm, toLocal } from "@/lib/schedule";
import { AppointmentForm } from "@/components/AppointmentForm";
import { SecretaryNav } from "@/components/SecretaryNav";

export const dynamic = "force-dynamic";

async function create(fd: FormData) {
  "use server";
  await requireOwner();
  const raw: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") raw[k] = v;
  const date = parseDate(raw.date) ?? todayInChicago();
  const parsed = parseAppointmentForm(raw, await listServices());
  if (!parsed.ok) redirect(`/secretary/new?date=${date}&error=${encodeURIComponent(parsed.errors.join(" | "))}`);
  const r = await addAppointment(parsed.value);
  if (!r.ok) redirect(`/secretary/new?date=${date}&error=${encodeURIComponent(r.error)}`);
  redirect(`/secretary?date=${toLocal(parsed.value.starts_at).date}&saved=1`);
}

export default async function NewAppointment({ searchParams }: { searchParams: Promise<{ date?: string; error?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  if (((await schemaVersion()) ?? 0) < 11) redirect("/secretary");
  const sp = await searchParams;
  const date = parseDate(sp.date) ?? todayInChicago();
  const services = await listServices();
  const first = services.find((s) => s.active);
  return (
    <main>
      <h1>New appointment</h1>
      <SecretaryNav date={date} active="new" />
      {sp.error && <div className="card err">{sp.error.split(" | ").map((e) => <div key={e}>{e}</div>)}</div>}
      <AppointmentForm action={create} services={services} submitLabel="Add appointment" values={{ date, time: "09:00", type: "office", service_code: first?.code ?? "", price: "" }} />
      <p><Link href={`/secretary?date=${date}`}>← Back to the calendar</Link></p>
    </main>
  );
}
