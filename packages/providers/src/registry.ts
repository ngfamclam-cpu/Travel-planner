import { SerpApiFlightProvider } from "./flights/serpapi";
import { UnconfiguredFlightProvider } from "./flights/unconfigured";
import { FastFlightsProvider } from "./flights/fastflights";
import { SerpApiHotelProvider } from "./hotels/serpapi";
import { UnconfiguredHotelProvider } from "./hotels/unconfigured";
import type { FlightProvider, HotelProvider, QueryCacheStore } from "./types";
import { TICKET_PLATFORMS, type TicketPlatformId } from "@rave-run/core";
import { PageChecker } from "./tickets/page";
import { SeatGeekChecker } from "./tickets/seatgeek";
import { TicketmasterChecker } from "./tickets/ticketmaster";
import type { TicketCheck, TicketChecker } from "./tickets/types";

export interface ProviderEnv {
  SERPAPI_KEY?: string;
  SERPAPI_COMBINE_AIRPORTS?: string;
  TICKETMASTER_API_KEY?: string;
  SEATGEEK_CLIENT_ID?: string;
  FAST_FLIGHTS_URL?: string;
  /** auto (default): free source first, SerpApi as fallback · free · serpapi */
  FLIGHT_SOURCE?: string;
}

class ManualOnly implements TicketChecker {
  configured = true;
  envKeys: string[] = [];
  constructor(public platform: TicketPlatformId) {}
  async check(): Promise<TicketCheck> {
    return { ok: false, platform: this.platform, error: "logged by hand only", noPrice: true };
  }
}

/** One checker per ticket platform: official APIs, polite page checks, or manual-only (Radiate). */
export function ticketCheckers(env: ProviderEnv): Record<TicketPlatformId, TicketChecker> {
  const out = {} as Record<TicketPlatformId, TicketChecker>;
  for (const p of Object.values(TICKET_PLATFORMS)) {
    out[p.id] =
      p.id === "ticketmaster"
        ? new TicketmasterChecker(env.TICKETMASTER_API_KEY)
        : p.id === "seatgeek"
          ? new SeatGeekChecker(env.SEATGEEK_CLIENT_ID)
          : p.access === "page"
            ? new PageChecker(p.id, { listedIncludesFees: p.listedIncludesFees })
            : new ManualOnly(p.id);
  }
  return out;
}

/**
 * Flight sources in order of use. With FAST_FLIGHTS_URL set (the default in docker compose),
 * the free source goes first and SerpApi (if keyed) is the fallback.
 */
export function flightProviders(env: ProviderEnv, cache?: QueryCacheStore): { primary: FlightProvider; fallback?: FlightProvider } {
  const source = (env.FLIGHT_SOURCE ?? "auto").toLowerCase();
  const free = env.FAST_FLIGHTS_URL ? new FastFlightsProvider({ baseUrl: env.FAST_FLIGHTS_URL, cache }) : null;
  const serp = env.SERPAPI_KEY ? flightProvider(env, cache) : null;
  if (source === "serpapi") return { primary: serp ?? new UnconfiguredFlightProvider() };
  if (source === "free") return { primary: free ?? new UnconfiguredFlightProvider() };
  if (free) return { primary: free, fallback: serp ?? undefined };
  return { primary: serp ?? new UnconfiguredFlightProvider() };
}

export function flightProvider(env: ProviderEnv, cache?: QueryCacheStore): FlightProvider {
  if (env.SERPAPI_KEY) {
    return new SerpApiFlightProvider({
      apiKey: env.SERPAPI_KEY,
      cache,
      combineAirports: env.SERPAPI_COMBINE_AIRPORTS !== "0",
    });
  }
  return new UnconfiguredFlightProvider();
}

export function hotelProvider(env: ProviderEnv, cache?: QueryCacheStore): HotelProvider {
  return env.SERPAPI_KEY ? new SerpApiHotelProvider({ apiKey: env.SERPAPI_KEY, cache }) : new UnconfiguredHotelProvider();
}

/** Every key the app knows about, for the setup page. */
export const KNOWN_KEYS: { env: string; purpose: string; step: number; required: boolean }[] = [
  { env: "FAST_FLIGHTS_URL", purpose: "Free Google Flights source (no key; set automatically by docker compose)", step: 3, required: false },
  { env: "SERPAPI_KEY", purpose: "Hotel prices; flight fallback if the free source is blocked", step: 3, required: false },
  { env: "TICKETMASTER_API_KEY", purpose: "Ticket tracker: face value + on-sale status", step: 4, required: false },
  { env: "EDMTRAIN_API_KEY", purpose: "EDM event calendar", step: 5, required: false },
  { env: "SEATGEEK_CLIENT_ID", purpose: "Ticket tracker: SeatGeek lowest price", step: 4, required: false },
  { env: "ANTHROPIC_API_KEY", purpose: "Daily brief prose + arrival guides", step: 8, required: false },
  { env: "RESEND_API_KEY", purpose: "Daily brief email", step: 8, required: false },
  { env: "VAPID_PUBLIC_KEY", purpose: "Web push notifications", step: 8, required: false },
  { env: "GOOGLE_PLACES_API_KEY", purpose: "Arrival guide place names", step: 9, required: false },
];
