import { addFavorite, addTripEntry, getTrip, listTripsAll, updateTripEntry } from "./db";
import { findDuplicate, parseTripEntry } from "./mileage";

export interface SaveState { errors?: string[]; duplicate?: boolean }

/** Checks the trip form and saves it (new, or an edit of trip `id`). Callers must have called requireOwner() first. */
export async function saveTripForm(raw: Record<string, string>, id?: number): Promise<{ ok: true } | ({ ok: false } & SaveState)> {
  const parsed = parseTripEntry(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const e = parsed.value;
  if (raw.allow_duplicate !== "1") {
    const around = await listTripsAll(e.driven_on, e.driven_on);
    const dup = findDuplicate(around, e, id);
    if (dup) return { ok: false, duplicate: true, errors: [`A trip on ${e.driven_on} from ${e.start_label} to ${e.end_label} with ${(e.miles_tenths / 10).toFixed(1)} miles is already saved. Tick "Save it anyway" if this is a second, separate trip.`] };
  }
  if (id !== undefined) {
    if (!(await getTrip(id))) return { ok: false, errors: ["That trip was not found."] };
    if (!(await updateTripEntry(id, e))) return { ok: false, errors: ["That trip was not found."] };
  } else await addTripEntry(e);
  if (raw.save_places === "1") { await addFavorite(e.start_label); await addFavorite(e.end_label); }
  return { ok: true };
}
