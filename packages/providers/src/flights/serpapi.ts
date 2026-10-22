// Google Flights via SerpApi (engine=google_flights). Free tier: verify the monthly quota on
// https://serpapi.com/pricing (their pages list 100–250/month); only successful searches count.
import { flightQueryKey, type FlightOffer, type FlightQuery } from "@rave-run/core";
import { serpApiGet } from "../serpapi-http";
import { SIX_HOURS_MS, type FlightProvider, type ProviderResult, type QueryCacheStore } from "../types";

export interface SerpApiOptions {
  apiKey?: string;
  cache?: QueryCacheStore;
  /**
   * Send all origins/destinations comma-joined in one search (saves quota). If SerpApi rejects
   * that, set SERPAPI_COMBINE_AIRPORTS=0 and the adapter runs one search per airport pair.
   */
  combineAirports?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface SerpLeg {
  departure_airport?: { id?: string; time?: string };
  arrival_airport?: { id?: string; time?: string };
  airline?: string;
  flight_number?: string;
}
interface SerpItinerary {
  flights?: SerpLeg[];
  layovers?: unknown[];
  total_duration?: number;
  price?: number;
  type?: string;
  booking_token?: string;
  departure_token?: string;
}
export interface SerpFlightsResponse {
  search_metadata?: { status?: string; google_flights_url?: string };
  error?: string;
  best_flights?: SerpItinerary[];
  other_flights?: SerpItinerary[];
  price_insights?: {
    lowest_price?: number;
    price_level?: string;
    typical_price_range?: number[];
    price_history?: number[][];
  };
}

export function serpApiParams(q: FlightQuery, apiKey: string, origins: string[], destinations: string[]): URLSearchParams {
  const cabin = { economy: "1", premium_economy: "2", business: "3", first: "4" }[q.cabin];
  return new URLSearchParams({
    engine: "google_flights",
    departure_id: origins.join(","),
    arrival_id: destinations.join(","),
    outbound_date: q.outboundDate,
    return_date: q.returnDate,
    type: "1", // round trip
    travel_class: cabin,
    adults: String(q.adults),
    currency: q.currency,
    hl: "en",
    gl: "us",
    api_key: apiKey,
  });
}

/** Turn a SerpApi Google Flights response into offers. Pure, so it is unit-tested with a fixture. */
export function parseSerpFlights(json: SerpFlightsResponse, q: FlightQuery): FlightOffer[] {
  const level = json.price_insights?.price_level?.toLowerCase();
  const insightLabel = level === "low" || level === "typical" || level === "high" ? level : undefined;
  const range = json.price_insights?.typical_price_range;
  const typicalRange = range?.length === 2 ? ([range[0], range[1]] as [number, number]) : undefined;
  const url = json.search_metadata?.google_flights_url;
  const itins = [...(json.best_flights ?? []), ...(json.other_flights ?? [])];
  const offers: FlightOffer[] = [];
  for (const it of itins) {
    if (typeof it.price !== "number" || !it.flights?.length) continue;
    const first = it.flights[0];
    const last = it.flights[it.flights.length - 1];
    const carriers = [...new Set(it.flights.map((f) => f.airline).filter(Boolean))];
    offers.push({
      provider: "serpapi_google_flights",
      price: it.price,
      currency: q.currency,
      origin: first.departure_airport?.id ?? q.origins[0],
      destination: last.arrival_airport?.id ?? q.destinations[0],
      outboundDate: q.outboundDate,
      returnDate: q.returnDate,
      stops: it.layovers?.length ?? Math.max(0, it.flights.length - 1),
      carrier: carriers.join(" / ") || "unknown",
      durationMinutes: it.total_duration,
      insightLabel,
      typicalRange,
      bookingUrl: url,
      raw: it,
    });
  }
  return offers;
}

export class SerpApiFlightProvider implements FlightProvider {
  readonly info;
  private readonly opts: SerpApiOptions;

  constructor(opts: SerpApiOptions) {
    this.opts = opts;
    this.info = { name: "serpapi_google_flights", tier: "free" as const, configured: !!opts.apiKey, envKeys: ["SERPAPI_KEY"] };
  }

  async search(q: FlightQuery): Promise<ProviderResult<FlightOffer>> {
    const name = this.info.name;
    if (!this.opts.apiKey) return { ok: false, provider: name, error: "SERPAPI_KEY not set", notConfigured: true };

    const key = flightQueryKey(name, q);
    if (this.opts.cache) {
      const hit = await this.opts.cache.get(key, SIX_HOURS_MS);
      if (hit) {
        const responses = hit.response as SerpFlightsResponse[];
        return {
          ok: true,
          provider: name,
          offers: responses.flatMap((r) => parseSerpFlights(r, q)),
          raw: responses,
          fetchedAt: hit.fetchedAt,
          cached: true,
          searchUrl: responses[0]?.search_metadata?.google_flights_url,
        };
      }
    }

    const combine = this.opts.combineAirports ?? true;
    const pairs: [string[], string[]][] = combine
      ? [[q.origins, q.destinations]]
      : q.origins.flatMap((o) => q.destinations.map((d) => [[o], [d]] as [string[], string[]]));

    const responses: SerpFlightsResponse[] = [];
    const errors: string[] = [];
    for (const [origins, destinations] of pairs) {
      try {
        responses.push(await this.fetchOne(q, origins, destinations));
      } catch (e) {
        errors.push(`${origins.join(",")}→${destinations.join(",")}: ${(e as Error).message}`);
      }
    }
    if (!responses.length) return { ok: false, provider: name, error: errors.join("; ") || "no response" };

    await this.opts.cache?.set(key, name, responses);
    return {
      ok: true,
      provider: name,
      offers: responses.flatMap((r) => parseSerpFlights(r, q)),
      raw: responses,
      fetchedAt: new Date(),
      cached: false,
      searchUrl: responses[0]?.search_metadata?.google_flights_url,
    };
  }

  /** Searches this call would spend against the quota (cache misses only). */
  cost(q: FlightQuery): number {
    return (this.opts.combineAirports ?? true) ? 1 : q.origins.length * q.destinations.length;
  }

  private fetchOne(q: FlightQuery, origins: string[], destinations: string[]): Promise<SerpFlightsResponse> {
    return serpApiGet<SerpFlightsResponse>(serpApiParams(q, this.opts.apiKey!, origins, destinations), this.opts);
  }
}
