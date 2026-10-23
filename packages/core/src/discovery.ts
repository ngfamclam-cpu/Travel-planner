// Event discovery: merge listings from several sources into events, de-duplicate, match artists.
import { diffDays, type ISODate } from "./dates";

export interface DiscoveredEvent {
  source: "edmtrain" | "ticketmaster";
  externalId: string;
  name: string;
  city: string;
  state?: string | null;
  country: string;
  venue?: string | null;
  lat?: number | null;
  lng?: number | null;
  start: ISODate;
  end: ISODate;
  artists: string[];
  url?: string | null;
  festival: boolean;
}

export function normalizeEventName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(20\d\d|festival|fest|presents|the|nye|music)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Edmtrain lists each festival day separately: merge same name + venue on consecutive days. */
export function mergeFestivalDays(items: DiscoveredEvent[]): DiscoveredEvent[] {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const out: DiscoveredEvent[] = [];
  for (const e of sorted) {
    const prev = out.find(
      (o) =>
        o.source === e.source &&
        normalizeEventName(o.name) === normalizeEventName(e.name) &&
        (o.venue ?? "") === (e.venue ?? "") &&
        diffDays(o.end, e.start) >= 0 &&
        diffDays(o.end, e.start) <= 1,
    );
    if (prev) {
      prev.end = e.end > prev.end ? e.end : prev.end;
      prev.artists = [...new Set([...prev.artists, ...e.artists])];
    } else {
      out.push({ ...e, artists: [...e.artists] });
    }
  }
  return out;
}

export interface KnownEvent {
  id: string;
  name: string;
  city: string;
  start: ISODate;
}

/** Same event if the names match closely, the city matches, and the start dates are within 4 days. */
export function findExisting(e: DiscoveredEvent, known: KnownEvent[]): KnownEvent | null {
  const n = normalizeEventName(e.name);
  const city = e.city.toLowerCase();
  return (
    known.find((k) => {
      const kn = normalizeEventName(k.name);
      const nameMatch = kn === n || (kn.length >= 5 && n.includes(kn)) || (n.length >= 5 && kn.includes(n));
      const cityMatch = !k.city || !city || k.city.toLowerCase().includes(city) || city.includes(k.city.toLowerCase());
      return nameMatch && cityMatch && Math.abs(diffDays(k.start, e.start)) <= 4;
    }) ?? null
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Which of the user's favourite artists play this event. */
export function matchingArtists(lineup: string[], favourites: string[]): string[] {
  const favs = favourites.map((f) => ({ f, n: norm(f) })).filter((x) => x.n.length >= 3);
  const out = new Set<string>();
  for (const a of lineup) {
    const an = norm(a);
    for (const { f, n } of favs) if (an === n || an.includes(n)) out.add(f);
  }
  return [...out];
}
