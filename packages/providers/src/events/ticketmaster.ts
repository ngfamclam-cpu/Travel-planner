// Ticketmaster Discovery API: US Dance/Electronic festivals (free key).
import type { DiscoveredEvent } from "@rave-run/core";
import type { HttpOpts } from "../tickets/types";

const DANCE_ELECTRONIC = "KnvZfZ7vAvF"; // Ticketmaster genre id for Dance/Electronic

interface TmEv {
  id: string;
  name: string;
  url?: string;
  dates?: { start?: { localDate?: string }; end?: { localDate?: string } };
  _embedded?: {
    venues?: { name?: string; city?: { name?: string }; state?: { stateCode?: string }; country?: { countryCode?: string }; location?: { latitude?: string; longitude?: string } }[];
    attractions?: { name?: string }[];
  };
}

export function parseTmDiscovery(json: { _embedded?: { events?: TmEv[] } }): DiscoveredEvent[] {
  const out: DiscoveredEvent[] = [];
  for (const e of json._embedded?.events ?? []) {
    const start = e.dates?.start?.localDate;
    if (!start) continue;
    const v = e._embedded?.venues?.[0];
    out.push({
      source: "ticketmaster",
      externalId: e.id,
      name: e.name,
      city: v?.city?.name ?? "",
      state: v?.state?.stateCode ?? null,
      country: v?.country?.countryCode ?? "US",
      venue: v?.name ?? null,
      lat: v?.location?.latitude ? Number(v.location.latitude) : null,
      lng: v?.location?.longitude ? Number(v.location.longitude) : null,
      start,
      end: e.dates?.end?.localDate ?? start,
      artists: (e._embedded?.attractions ?? []).map((a) => a.name ?? "").filter(Boolean),
      url: e.url ?? null,
      festival: /festival|fest\b/i.test(e.name),
    });
  }
  return out;
}

export async function fetchTicketmasterFestivals(apiKey: string, range: { from: string; to: string }, opts: HttpOpts = {}): Promise<DiscoveredEvent[]> {
  const q = new URLSearchParams({
    apikey: apiKey,
    genreId: DANCE_ELECTRONIC,
    keyword: "festival",
    countryCode: "US",
    startDateTime: `${range.from}T00:00:00Z`,
    endDateTime: `${range.to}T23:59:59Z`,
    size: "100",
    sort: "date,asc",
  });
  const res = await (opts.fetchImpl ?? fetch)(`https://app.ticketmaster.com/discovery/v2/events.json?${q}`, { signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000) });
  if (!res.ok) throw new Error(`Ticketmaster HTTP ${res.status}`);
  return parseTmDiscovery((await res.json()) as Parameters<typeof parseTmDiscovery>[0]).filter((e) => e.festival);
}
