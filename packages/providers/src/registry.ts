import { SerpApiFlightProvider } from "./flights/serpapi";
import { UnconfiguredFlightProvider } from "./flights/unconfigured";
import type { FlightProvider, QueryCacheStore } from "./types";

export interface ProviderEnv {
  SERPAPI_KEY?: string;
  SERPAPI_COMBINE_AIRPORTS?: string;
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

/** Every key the app knows about, for the setup page. */
export const KNOWN_KEYS: { env: string; purpose: string; step: number; required: boolean }[] = [
  { env: "SERPAPI_KEY", purpose: "Google Flights + Google Hotels prices", step: 3, required: true },
  { env: "TICKETMASTER_API_KEY", purpose: "Event discovery + ticket prices", step: 5, required: false },
  { env: "EDMTRAIN_API_KEY", purpose: "EDM event calendar", step: 5, required: false },
  { env: "SEATGEEK_CLIENT_ID", purpose: "Resale ticket floors", step: 5, required: false },
  { env: "ANTHROPIC_API_KEY", purpose: "Daily brief prose + arrival guides", step: 8, required: false },
  { env: "RESEND_API_KEY", purpose: "Daily brief email", step: 8, required: false },
  { env: "VAPID_PUBLIC_KEY", purpose: "Web push notifications", step: 8, required: false },
  { env: "GOOGLE_PLACES_API_KEY", purpose: "Arrival guide place names", step: 9, required: false },
];
