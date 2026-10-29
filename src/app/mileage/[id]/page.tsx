import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, getTrip, listFavorites, listTripEdits } from "@/lib/db";
import { CATEGORY_CHOICES, CATEGORY_LABELS, PURPOSES, PURPOSE_LABELS, SOURCE_LABELS, formatMiles } from "@/lib/mileage";
import { saveTripForm, type SaveState } from "@/lib/mileageService";
import { TripForm } from "@/components/TripForm";

export const dynamic = "force-dynamic";

const FIELDS: Record<string, string> = { driven_on: "Date", start_label: "Start", end_label: "Destination", purpose: "Purpose", trip_type: "Trip", category: "Type", miles_tenths: "Total miles", miles_status: "Status", distance_source: "Source", remarks: "Notes", one_way_est_tenths: "One-way estimate", odometer_start: "Odometer start", odometer_end: "Odometer end" };
const show = (k: string, v: unknown): string => {
  if (v === null || v === undefined || v === "") return "(empty)";
  if (k === "miles_tenths" || k === "one_way_est_tenths") return `${formatMiles(Number(v))} mi`;
  if (k === "purpose") return PURPOSE_LABELS[String(v)] ?? String(v);
  if (k === "category") return CATEGORY_LABELS[String(v)] ?? String(v);
  if (k === "distance_source") return SOURCE_LABELS[String(v)] ?? String(v);
  if (k === "trip_type") return v === "round_trip" ? "round trip" : "one way";
  return String(v);
};

export default async function EditTrip({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const { id: raw } = await params;
  const id = /^\d{1,12}$/.test(raw) ? Number(raw) : 0;
  const trip = id ? await getTrip(id) : null;
  if (!trip) notFound();
  const [favorites, edits] = await Promise.all([listFavorites(), listTripEdits(id)]);

  async function save(_prev: SaveState, fd: FormData): Promise<SaveState> {
    "use server";
    await requireOwner();
    const form: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (typeof v === "string") form[k] = v;
    const r = await saveTripForm(form, id);
    if (!r.ok) return { errors: r.errors, duplicate: r.duplicate };
    redirect("/mileage?saved=1");
  }

  const t = trip!;
  const routeSource = t.distance_source === "route_address" || t.distance_source === "route_city";
  return (
    <main>
      <p><Link href="/mileage">← Mileage</Link></p>
      <h1>Edit trip</h1>
      <div className="note">Every change is kept below, with what the trip looked like before.</div>
      <TripForm action={save} favorites={favorites.map((f) => f.label)} purposes={PURPOSES.map((x) => ({ id: x.id, label: x.label }))} categories={CATEGORY_CHOICES} routingReady={Boolean((process.env.ORS_API_KEY ?? "").trim())} submitLabel="Save changes"
        defaults={{
          driven_on: t.driven_on, start_label: t.start_label ?? "", end_label: t.end_label ?? "", purpose: t.purpose, trip_type: t.trip_type ?? "one_way", category: t.category ?? "business", remarks: t.remarks ?? "",
          estimate_tenths: t.one_way_est_tenths ? String(t.one_way_est_tenths) : "", estimate_source: routeSource ? t.distance_source! : "route_city",
          actual_miles: t.miles_status === "actual" ? formatMiles(t.miles_tenths) : "", odometer_start: t.odometer_start === null ? "" : String(t.odometer_start), odometer_end: t.odometer_end === null ? "" : String(t.odometer_end),
        }} />
      <div className="card"><h2>Change history</h2>
        {edits.length === 0 ? <p className="muted">This trip has not been edited.</p> : (
          <ul className="entries">{edits.map((e) => {
            const changed = Object.keys(FIELDS).filter((k) => String(e.before[k] ?? "") !== String(e.after?.[k] ?? ""));
            return <li className="entry" key={e.id}><span className="what">{e.edited_at}</span>
              <span className="meta">{changed.length === 0 ? "Saved without changes." : changed.map((k) => `${FIELDS[k]}: ${show(k, e.before[k])} → ${show(k, e.after?.[k])}`).join(" · ")}</span></li>;
          })}</ul>
        )}
      </div>
    </main>
  );
}
