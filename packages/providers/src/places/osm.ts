// OpenStreetMap: free, no key. Nominatim to find the venue, Overpass for places nearby.
// Usage policies ask for an identifying User-Agent and light use (≤1 request/second), which a
// weekly guide refresh easily respects.
import { opensLate, type Place } from "@rave-run/core";
import type { HttpOpts } from "../tickets/types";

const UA = "RaveRun/0.1 (personal trip planner; https://github.com/ngfamclam-cpu/Travel-planner)";

export async function geocode(query: string, opts: HttpOpts = {}): Promise<{ lat: number; lng: number; label: string } | null> {
  const q = new URLSearchParams({ q: query, format: "jsonv2", limit: "1" });
  const res = await (opts.fetchImpl ?? fetch)(`https://nominatim.openstreetmap.org/search?${q}`, {
    headers: { "user-agent": UA, "accept-language": "en" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!rows.length) return null;
  return { lat: Number(rows[0].lat), lng: Number(rows[0].lon), label: rows[0].display_name };
}

interface OsmEl {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export function overpassQuery(lat: number, lng: number, foodRadius = 1500, sightRadius = 4000): string {
  const around = (r: number) => `(around:${r},${lat},${lng})`;
  return `[out:json][timeout:25];
(
  nwr["amenity"~"^(restaurant|fast_food|cafe|food_court)$"]["name"]${around(foodRadius)};
  nwr["amenity"~"^(bar|pub|nightclub)$"]["name"]${around(foodRadius)};
  nwr["tourism"~"^(attraction|museum|gallery|viewpoint)$"]["name"]${around(sightRadius)};
  nwr["leisure"~"^(park|beach_resort)$"]["name"]${around(sightRadius)};
);
out center tags 300;`;
}

export function parseOverpass(json: { elements?: OsmEl[] }): Place[] {
  const out: Place[] = [];
  for (const el of json.elements ?? []) {
    const t = el.tags ?? {};
    if (!t.name) continue;
    const kind: Place["kind"] = t.amenity && /restaurant|fast_food|cafe|food_court/.test(t.amenity)
      ? "food"
      : t.amenity && /bar|pub/.test(t.amenity)
        ? "drink"
        : t.amenity === "nightclub"
          ? "nightlife"
          : t.leisure
            ? "park"
            : "sight";
    const lat = el.lat ?? el.center?.lat ?? null;
    const lng = el.lon ?? el.center?.lon ?? null;
    out.push({
      id: `osm:${el.type}/${el.id}`,
      name: t["name:en"] ?? t.name,
      kind,
      cuisine: t.cuisine ?? null,
      address: [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ") || null,
      lateNight: opensLate(t.opening_hours),
      url: t.website ?? (lat != null ? `https://www.openstreetmap.org/${el.type}/${el.id}` : null),
      lat,
      lng,
    });
  }
  return out;
}

export async function osmPlaces(lat: number, lng: number, opts: HttpOpts = {}): Promise<Place[]> {
  const res = await (opts.fetchImpl ?? fetch)("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: overpassQuery(lat, lng) }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return parseOverpass((await res.json()) as { elements?: OsmEl[] });
}
