// Ticketmaster Discovery API (free key). priceRanges are face value and usually exclude fees.
import type { TicketChecker, TicketCheck, TicketEventRef, TicketMatch, HttpOpts } from "./types";

const BASE = "https://app.ticketmaster.com/discovery/v2";

interface TmEvent {
  id: string;
  name: string;
  url?: string;
  dates?: { start?: { localDate?: string }; status?: { code?: string } };
  priceRanges?: { type?: string; currency?: string; min?: number; max?: number }[];
  _embedded?: { venues?: { city?: { name?: string } }[] };
}

/** Map Ticketmaster's status codes to the tracker's. */
export function tmStatus(code?: string): string | null {
  if (!code) return null;
  const c = code.toLowerCase();
  if (c === "onsale") return "onsale";
  if (c === "offsale") return "offsale";
  if (c === "canceled" || c === "cancelled") return "cancelled";
  return c; // postponed, rescheduled
}

export function parseTmEvent(ev: TmEvent): TicketCheck {
  const status = tmStatus(ev.dates?.status?.code);
  const prices = (ev.priceRanges ?? []).map((p) => p.min).filter((n): n is number => typeof n === "number" && n > 0);
  const url = ev.url ?? `https://www.ticketmaster.com/event/${ev.id}`;
  if (!prices.length) return { ok: false, platform: "ticketmaster", error: "no face-value price published", noPrice: true, status };
  return { ok: true, platform: "ticketmaster", listed: Math.min(...prices), feesIncluded: false, tierLabel: "face value", status, url, raw: ev };
}

export class TicketmasterChecker implements TicketChecker {
  platform = "ticketmaster" as const;
  envKeys = ["TICKETMASTER_API_KEY"];
  configured: boolean;
  constructor(private apiKey?: string, private http: HttpOpts = {}) {
    this.configured = !!apiKey;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const q = new URLSearchParams({ ...params, apikey: this.apiKey! });
    const res = await (this.http.fetchImpl ?? fetch)(`${BASE}${path}?${q}`, { signal: AbortSignal.timeout(this.http.timeoutMs ?? 30_000) });
    if (!res.ok) throw new Error(`Ticketmaster HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async find(e: TicketEventRef): Promise<TicketMatch | null> {
    if (!this.apiKey) return null;
    const json = await this.get<{ _embedded?: { events?: TmEvent[] } }>("/events.json", {
      keyword: e.name,
      startDateTime: `${e.start}T00:00:00Z`,
      endDateTime: `${e.end}T23:59:59Z`,
      size: "10",
      sort: "date,asc",
    });
    const events = json._embedded?.events ?? [];
    const city = e.city.toLowerCase();
    const best = events.find((x) => x._embedded?.venues?.some((v) => (v.city?.name ?? "").toLowerCase().includes(city))) ?? events[0];
    return best ? { url: best.url ?? `https://www.ticketmaster.com/event/${best.id}`, externalId: best.id, title: best.name } : null;
  }

  async check(w: { url?: string | null; externalId?: string | null }): Promise<TicketCheck> {
    if (!this.apiKey) return { ok: false, platform: "ticketmaster", error: "TICKETMASTER_API_KEY not set", notConfigured: true };
    if (!w.externalId) return { ok: false, platform: "ticketmaster", error: "not matched to a Ticketmaster event yet", noPrice: true };
    try {
      return parseTmEvent(await this.get<TmEvent>(`/events/${encodeURIComponent(w.externalId)}.json`, {}));
    } catch (e) {
      return { ok: false, platform: "ticketmaster", error: (e as Error).message };
    }
  }
}
