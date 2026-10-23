// Google Flights' price calendar through the flights-free sidecar (open-source fli library).
// One request returns the cheapest fare for every date in a ≤61-day range on one route.
import type { AsiaSeries } from "@rave-run/core";

export interface CalendarPrice {
  date: string;
  return?: string;
  price: number;
}

export type CalendarResult =
  | { ok: true; prices: CalendarPrice[] }
  | { ok: false; kind: "blocked" | "parse" | "network" | "bad_request" | "unreachable" | "not_configured"; error: string };

export class FlightCalendarClient {
  constructor(private opts: { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {}

  get configured(): boolean {
    return !!this.opts.baseUrl;
  }

  async calendar(req: AsiaSeries["request"]): Promise<CalendarResult> {
    if (!this.opts.baseUrl) return { ok: false, kind: "not_configured", error: "FAST_FLIGHTS_URL not set (flights-free sidecar not running)" };
    try {
      const res = await (this.opts.fetchImpl ?? fetch)(`${this.opts.baseUrl.replace(/\/$/, "")}/calendar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...req, currency: "USD" }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 180_000),
      });
      if (res.status === 404) return { ok: false, kind: "unreachable", error: "sidecar has no /calendar: rebuild the flights-free image" };
      const json = (await res.json()) as CalendarResult;
      if (!json.ok) return json;
      return { ok: true, prices: (json.prices ?? []).filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && typeof p.price === "number" && p.price > 0) };
    } catch (e) {
      return { ok: false, kind: "unreachable", error: `sidecar unreachable: ${(e as Error).message}` };
    }
  }
}
