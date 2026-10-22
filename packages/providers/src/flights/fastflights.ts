// Free Google Flights source: the flights-free sidecar (open-source fast-flights library).
// No key or account. One request per origin × destination pair, so it is rationed by
// request count, and the worker falls back to SerpApi when it's blocked or broken.
import { flightQueryKey, type FlightOffer, type FlightQuery } from "@rave-run/core";
import { SIX_HOURS_MS, type FlightProvider, type ProviderResult, type QueryCacheStore } from "../types";

export interface FastFlightsOptions {
  baseUrl?: string;
  cache?: QueryCacheStore;
  fetchImpl?: typeof fetch;
  /** The sidecar spaces requests itself (one every ~5–8s), so allow time for a queue. */
  timeoutMs?: number;
}

interface SidecarOffer {
  price: number;
  currency: string;
  origin: string;
  destination: string;
  airlines: string[];
  stops: number;
  minutes: number;
  legs: unknown[];
}

type SidecarResponse =
  | { ok: true; offers: SidecarOffer[]; url: string }
  | { ok: false; kind: "blocked" | "parse" | "network" | "bad_request"; error: string; url?: string };

export function fastFlightsOffers(json: Extract<SidecarResponse, { ok: true }>, q: FlightQuery): FlightOffer[] {
  return json.offers
    .filter((o) => typeof o.price === "number" && o.price > 0)
    .map((o) => ({
      provider: "google_flights_free",
      price: o.price,
      currency: o.currency || q.currency,
      origin: o.origin,
      destination: o.destination,
      outboundDate: q.outboundDate,
      returnDate: q.returnDate,
      stops: o.stops,
      carrier: o.airlines.join(" / ") || "unknown",
      durationMinutes: o.minutes,
      bookingUrl: json.url,
      raw: o,
    }));
}

export class FastFlightsProvider implements FlightProvider {
  readonly info;
  constructor(private opts: FastFlightsOptions) {
    this.info = { name: "google_flights_free", tier: "free" as const, configured: !!opts.baseUrl, envKeys: ["FAST_FLIGHTS_URL"], costPerPair: true };
  }

  /** Requests this query costs: one per airport pair. */
  cost(q: FlightQuery): number {
    return q.origins.length * q.destinations.length;
  }

  async search(q: FlightQuery): Promise<ProviderResult<FlightOffer>> {
    const name = this.info.name;
    if (!this.opts.baseUrl) return { ok: false, provider: name, error: "FAST_FLIGHTS_URL not set (flights-free sidecar not running)", notConfigured: true };
    const key = flightQueryKey(name, q);
    const hit = await this.opts.cache?.get(key, SIX_HOURS_MS);
    if (hit) {
      const responses = hit.response as Extract<SidecarResponse, { ok: true }>[];
      return { ok: true, provider: name, offers: responses.flatMap((r) => fastFlightsOffers(r, q)), raw: responses, fetchedAt: hit.fetchedAt, cached: true, searchUrl: responses[0]?.url };
    }

    const ok: Extract<SidecarResponse, { ok: true }>[] = [];
    const errors: string[] = [];
    for (const origin of q.origins) {
      for (const destination of q.destinations) {
        try {
          const res = await (this.opts.fetchImpl ?? fetch)(`${this.opts.baseUrl.replace(/\/$/, "")}/search`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ origin, destination, outbound: q.outboundDate, return: q.returnDate, adults: q.adults, cabin: q.cabin, currency: q.currency }),
            signal: AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
          });
          const json = (await res.json()) as SidecarResponse;
          if (json.ok) ok.push(json);
          else errors.push(`${origin}→${destination}: ${json.kind}: ${json.error}`);
        } catch (e) {
          errors.push(`${origin}→${destination}: sidecar unreachable: ${(e as Error).message}`);
        }
      }
    }
    if (!ok.length) return { ok: false, provider: name, error: errors.join("; ") || "no response" };
    await this.opts.cache?.set(key, name, ok);
    return {
      ok: true,
      provider: name,
      offers: ok.flatMap((r) => fastFlightsOffers(r, q)),
      raw: { responses: ok, errors },
      fetchedAt: new Date(),
      cached: false,
      searchUrl: ok[0]?.url,
    };
  }
}
