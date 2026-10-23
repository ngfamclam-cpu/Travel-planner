// Edmtrain events API (free key on request: edmtrain.com/developer). Their terms require each shown
// event to link to the event URL from the response, unmodified, so `url` is kept as given.
import type { DiscoveredEvent } from "@rave-run/core";
import type { HttpOpts } from "../tickets/types";

const BASE = "https://edmtrain.com/api";

interface EdmVenue {
  name?: string;
  location?: string; // "Miami, FL"
  state?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}
interface EdmEvent {
  id?: number;
  link?: string;
  name?: string | null;
  date?: string;
  festivalInd?: boolean;
  electronicGenreInd?: boolean;
  venue?: EdmVenue;
  artistList?: { name?: string }[];
}

export function parseEdmtrain(json: { success?: boolean; message?: string; data?: EdmEvent[] }): DiscoveredEvent[] {
  if (json.success === false) throw new Error(json.message ?? "Edmtrain returned success=false");
  const out: DiscoveredEvent[] = [];
  for (const e of json.data ?? []) {
    if (!e.date || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
    const artists = (e.artistList ?? []).map((a) => a.name ?? "").filter(Boolean);
    const name = e.name?.trim() || (artists.length ? artists.slice(0, 3).join(", ") : "");
    if (!name) continue;
    const city = (e.venue?.location ?? "").split(",")[0].trim();
    out.push({
      source: "edmtrain",
      externalId: String(e.id ?? `${name}-${e.date}`),
      name,
      city: city || e.venue?.state || "",
      state: e.venue?.state ?? null,
      country: e.venue?.country && e.venue.country !== "United States" ? e.venue.country : "US",
      venue: e.venue?.name ?? null,
      lat: e.venue?.latitude ?? null,
      lng: e.venue?.longitude ?? null,
      start: e.date,
      end: e.date,
      artists,
      url: e.link ?? null,
      festival: !!e.festivalInd,
    });
  }
  return out;
}

export async function fetchEdmtrainFestivals(
  apiKey: string,
  range: { from: string; to: string },
  opts: HttpOpts & { locationIds?: string } = {},
): Promise<DiscoveredEvent[]> {
  const q = new URLSearchParams({ client: apiKey, festivalInd: "true", startDate: range.from, endDate: range.to });
  if (opts.locationIds) q.set("locationIds", opts.locationIds);
  const res = await (opts.fetchImpl ?? fetch)(`${BASE}/events?${q}`, { signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000) });
  if (!res.ok) throw new Error(`Edmtrain HTTP ${res.status}`);
  return parseEdmtrain((await res.json()) as Parameters<typeof parseEdmtrain>[0]);
}
