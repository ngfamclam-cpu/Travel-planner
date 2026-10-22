// Common provider contracts (spec §5). Every provider fails soft: it returns ok:false with a
// reason instead of throwing, so the worker and brief can say "couldn't check X today".
import type { FlightOffer, FlightQuery } from "@rave-run/core";

export type ProviderResult<T> =
  | { ok: true; provider: string; offers: T[]; raw: unknown; fetchedAt: Date; cached: boolean; searchUrl?: string }
  | { ok: false; provider: string; error: string; notConfigured?: boolean };

export interface ProviderInfo {
  name: string;
  tier: "free" | "paid";
  configured: boolean;
  /** Env var(s) that turn this provider on. */
  envKeys: string[];
}

export interface FlightProvider {
  info: ProviderInfo;
  search(q: FlightQuery): Promise<ProviderResult<FlightOffer>>;
}

// The interfaces below are implemented in later build steps (hotels: step 4, events: step 5, awards: step 10).
export interface HotelQuery {
  location: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  minStars: number;
  minRating10: number;
  near?: { lat: number; lng: number };
}
export interface HotelOffer {
  provider: string;
  name: string;
  pricePerNight: number;
  total: number;
  stars?: number;
  rating10?: number;
  refundable?: boolean;
  bookingUrl?: string;
}
export interface HotelProvider {
  info: ProviderInfo;
  search(q: HotelQuery): Promise<ProviderResult<HotelOffer>>;
}

export interface EventQuery {
  region: "US" | "Asia";
  from: string;
  to: string;
  genres?: string[];
}
export interface EventListing {
  provider: string;
  name: string;
  city: string;
  country: string;
  venue?: string;
  startDate: string;
  endDate: string;
  url?: string;
  genres?: string[];
}
export interface EventProvider {
  info: ProviderInfo;
  list(q: EventQuery): Promise<ProviderResult<EventListing>>;
}

export interface AwardQuery {
  origins: string[];
  destinations: string[];
  date: string;
  cabin: string;
}
export interface AwardOffer {
  provider: string;
  program: string;
  points: number;
  taxesFees: number;
  cabin: string;
  date: string;
}
export interface AwardProvider {
  info: ProviderInfo;
  search(q: AwardQuery): Promise<ProviderResult<AwardOffer>>;
}

/** Cache used for the 6-hour identical-query rule; the worker backs it with Postgres. */
export interface QueryCacheStore {
  get(key: string, maxAgeMs: number): Promise<{ response: unknown; fetchedAt: Date } | null>;
  set(key: string, provider: string, response: unknown): Promise<void>;
}

export const SIX_HOURS_MS = 6 * 3_600_000;
