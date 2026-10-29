/*
 * Driving-distance estimates from a road-routing service (OpenRouteService). The service needs a free API key, kept only in the server setting
 * ORS_API_KEY; it is sent in a request header and never put in a page, a link, a log or an error message. Cities are looked up to a point on
 * the map (the middle of the city) and the road distance between the two points is returned, so a city-to-city result is an estimate.
 * Everything that talks to the network takes the fetch function as an argument, so tests never call the real service.
 */
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type EstimateFailure = "no_key" | "not_found" | "no_route" | "limit" | "unavailable";
export type Estimate = { ok: true; oneWayTenths: number; source: "route_city" | "route_address"; from: string; to: string } | { ok: false; reason: EstimateFailure; message: string };

export const MESSAGES: Record<EstimateFailure, string> = {
  no_key: "Automatic mileage is not set up (no routing key on the server). Type the miles yourself.",
  not_found: "One of the places was not found. Check the spelling, add the state (like Abilene, TX), or type the miles yourself.",
  no_route: "No driving route was found between those places. Type the miles yourself.",
  limit: "The routing service's usage limit was reached. Try again later or type the miles yourself.",
  unavailable: "The routing service is not answering right now. Type the miles yourself and try the estimate again later.",
};
const fail = (reason: EstimateFailure): Estimate => ({ ok: false, reason, message: MESSAGES[reason] });

export const METERS_PER_MILE = 1609.344;
/** Meters -> tenths of a mile, never less than one tenth. */
export const metersToTenths = (m: number): number => Math.max(1, Math.round((m / METERS_PER_MILE) * 10));

const BASE = "https://api.openrouteservice.org";
const timeout = () => AbortSignal.timeout(8000);

interface Point { lon: number; lat: number; label: string }

async function geocode(text: string, cityOnly: boolean, key: string, f: FetchLike): Promise<Point | EstimateFailure> {
  const attempt = async (layers: boolean): Promise<Point | null | EstimateFailure> => {
    const q = new URLSearchParams({ text, size: "1", "boundary.country": "US" });
    if (layers) q.set("layers", "locality,localadmin");
    const res = await f(`${BASE}/geocode/search?${q}`, { headers: { Authorization: key, Accept: "application/json" }, signal: timeout() });
    if (res.status === 429) return "limit";
    if (res.status === 401 || res.status === 403) return "no_key";
    if (!res.ok) return "unavailable";
    const body = (await res.json()) as { features?: { geometry?: { coordinates?: number[] }; properties?: { label?: string } }[] };
    const feat = body.features?.[0], c = feat?.geometry?.coordinates;
    if (!c || c.length < 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
    return { lon: c[0], lat: c[1], label: feat?.properties?.label ?? text };
  };
  const first = await attempt(cityOnly);
  if (first === null && cityOnly) { const second = await attempt(false); return second === null ? "not_found" : second; }
  return first === null ? "not_found" : first;
}

/** One-way driving distance. `fromStreet` / `toStreet` are optional and sharpen the result; they are used for this one lookup only. */
export async function estimateDrivingMiles(args: { from: string; to: string; fromStreet?: string; toStreet?: string }, key: string | undefined, f: FetchLike): Promise<Estimate> {
  if (!key || key.trim() === "") return fail("no_key");
  try {
    const a = await geocode(args.fromStreet ? `${args.fromStreet}, ${args.from}` : args.from, !args.fromStreet, key, f);
    if (typeof a === "string") return fail(a);
    const b = await geocode(args.toStreet ? `${args.toStreet}, ${args.to}` : args.to, !args.toStreet, key, f);
    if (typeof b === "string") return fail(b);
    const res = await f(`${BASE}/v2/directions/driving-car`, {
      method: "POST", headers: { Authorization: key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ coordinates: [[a.lon, a.lat], [b.lon, b.lat]], units: "m", instructions: false, geometry: false }), signal: timeout(),
    });
    if (res.status === 429) return fail("limit");
    if (res.status === 401 || res.status === 403) return fail("no_key");
    if (res.status === 404) return fail("no_route");
    if (res.status === 400) { const e = (await res.json().catch(() => null)) as { error?: { code?: number } } | null; return fail(e?.error?.code === 2010 || e?.error?.code === 2009 ? "no_route" : "unavailable"); }
    if (!res.ok) return fail("unavailable");
    const body = (await res.json()) as { routes?: { summary?: { distance?: number } }[] };
    const meters = body.routes?.[0]?.summary?.distance;
    if (typeof meters !== "number" || !Number.isFinite(meters) || meters <= 0) return fail("no_route");
    return { ok: true, oneWayTenths: metersToTenths(meters), source: args.fromStreet || args.toStreet ? "route_address" : "route_city", from: a.label, to: b.label };
  } catch {
    return fail("unavailable"); // network error or timeout; the message never includes the request, so the key cannot leak
  }
}
