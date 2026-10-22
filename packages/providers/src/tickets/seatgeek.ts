// SeatGeek platform API (free client_id). stats.lowest_price is treated as before fees.
import type { TicketChecker, TicketCheck, TicketEventRef, TicketMatch, HttpOpts } from "./types";

const BASE = "https://api.seatgeek.com/2";

interface SgEvent {
  id: number;
  title?: string;
  url?: string;
  datetime_local?: string;
  venue?: { city?: string };
  stats?: { lowest_price?: number | null; listing_count?: number | null };
}

export function parseSgEvent(ev: SgEvent): TicketCheck {
  const url = ev.url ?? `https://seatgeek.com/e/${ev.id}`;
  const low = ev.stats?.lowest_price;
  if (typeof low !== "number" || low <= 0) return { ok: false, platform: "seatgeek", error: "no listings right now", noPrice: true };
  return { ok: true, platform: "seatgeek", listed: low, feesIncluded: false, tierLabel: "lowest listing", url, raw: ev };
}

export class SeatGeekChecker implements TicketChecker {
  platform = "seatgeek" as const;
  envKeys = ["SEATGEEK_CLIENT_ID"];
  configured: boolean;
  constructor(private clientId?: string, private http: HttpOpts = {}) {
    this.configured = !!clientId;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const q = new URLSearchParams({ ...params, client_id: this.clientId! });
    const res = await (this.http.fetchImpl ?? fetch)(`${BASE}${path}?${q}`, { signal: AbortSignal.timeout(this.http.timeoutMs ?? 30_000) });
    if (!res.ok) throw new Error(`SeatGeek HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async find(e: TicketEventRef): Promise<TicketMatch | null> {
    if (!this.clientId) return null;
    const json = await this.get<{ events?: SgEvent[] }>("/events", {
      q: e.name,
      "datetime_local.gte": `${e.start}T00:00:00`,
      "datetime_local.lte": `${e.end}T23:59:59`,
      per_page: "10",
    });
    const events = json.events ?? [];
    const city = e.city.toLowerCase();
    const best = events.find((x) => (x.venue?.city ?? "").toLowerCase().includes(city)) ?? events[0];
    return best ? { url: best.url ?? `https://seatgeek.com/e/${best.id}`, externalId: String(best.id), title: best.title } : null;
  }

  async check(w: { url?: string | null; externalId?: string | null }): Promise<TicketCheck> {
    if (!this.clientId) return { ok: false, platform: "seatgeek", error: "SEATGEEK_CLIENT_ID not set", notConfigured: true };
    if (!w.externalId) return { ok: false, platform: "seatgeek", error: "not matched to a SeatGeek event yet", noPrice: true };
    try {
      return parseSgEvent(await this.get<SgEvent>(`/events/${encodeURIComponent(w.externalId)}`, {}));
    } catch (e) {
      return { ok: false, platform: "seatgeek", error: (e as Error).message };
    }
  }
}
