// Google Hotels via SerpApi (engine=google_hotels). Shares the SerpApi quota with flights.
import { hotelQueryKey, type HotelOffer, type HotelQuery } from "@rave-run/core";
import { serpApiGet } from "../serpapi-http";
import { SIX_HOURS_MS, type HotelProvider, type ProviderResult, type QueryCacheStore } from "../types";

export interface SerpApiHotelOptions {
  apiKey?: string;
  cache?: QueryCacheStore;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type Money = { lowest?: string; extracted_lowest?: number; before_taxes_fees?: string; extracted_before_taxes_fees?: number };

interface SerpProperty {
  type?: string;
  name?: string;
  link?: string;
  property_token?: string;
  gps_coordinates?: { latitude?: number; longitude?: number };
  rate_per_night?: Money;
  total_rate?: Money;
  hotel_class?: string;
  extracted_hotel_class?: number;
  overall_rating?: number;
  reviews?: number;
  free_cancellation?: boolean;
  deal?: string;
}

export interface SerpHotelsResponse {
  search_metadata?: { status?: string; google_hotels_url?: string };
  error?: string;
  properties?: SerpProperty[];
  ads?: unknown[];
}

export function serpHotelParams(q: HotelQuery, apiKey: string): URLSearchParams {
  const p = new URLSearchParams({
    engine: "google_hotels",
    q: q.location,
    check_in_date: q.checkIn,
    check_out_date: q.checkOut,
    adults: String(q.adults),
    currency: q.currency,
    hl: "en",
    gl: "us",
    sort_by: "3", // lowest price
    api_key: apiKey,
  });
  if (q.lodging === "rentals") {
    // Google's vacation rentals (Airbnb/VRBO-style listings): no star classes.
    p.set("vacation_rentals", "true");
  } else {
    const classes = [2, 3, 4, 5].filter((c) => c >= Math.ceil(q.minStars));
    if (classes.length && classes.length < 4) p.set("hotel_class", classes.join(","));
  }
  if (q.refundableOnly) p.set("free_cancellation", "true");
  return p;
}

/** "$1,234" → 1234 */
function amount(m?: Money, preferBeforeTax = false): number | undefined {
  if (!m) return undefined;
  const n = preferBeforeTax ? m.extracted_before_taxes_fees : m.extracted_lowest;
  if (typeof n === "number") return n;
  const s = preferBeforeTax ? m.before_taxes_fees : m.lowest;
  const parsed = s ? Number(s.replace(/[^0-9.]/g, "")) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function stars(p: SerpProperty): number | undefined {
  if (typeof p.extracted_hotel_class === "number") return p.extracted_hotel_class;
  const m = p.hotel_class?.match(/(\d)(?:\.\d)?-star/);
  return m ? Number(m[1]) : undefined;
}

/** Parse properties into offers. Pure; unit-tested with a fixture. Prices include taxes/fees when Google gives them. */
export function parseSerpHotels(json: SerpHotelsResponse, q: HotelQuery): HotelOffer[] {
  const n = Math.max(1, Math.round((Date.parse(q.checkOut) - Date.parse(q.checkIn)) / 86_400_000));
  const url = json.search_metadata?.google_hotels_url;
  const offers: HotelOffer[] = [];
  for (const p of json.properties ?? []) {
    if (!p.name) continue;
    // Hotel searches skip rentals; rental searches keep only rentals.
    const isRental = !!p.type && p.type !== "hotel";
    if (isRental !== (q.lodging === "rentals")) continue;
    const perNight = amount(p.rate_per_night);
    const total = amount(p.total_rate) ?? (perNight != null ? perNight * n : undefined);
    if (total == null) continue;
    offers.push({
      provider: "serpapi_google_hotels",
      name: p.name,
      pricePerNight: Math.round((total / n) * 100) / 100,
      total,
      currency: q.currency,
      stars: stars(p),
      rating5: p.overall_rating,
      reviews: p.reviews,
      lodgingType: isRental ? p.type : undefined,
      // Searches use Google's free-cancellation filter; a property flag wins if present.
      refundable: p.free_cancellation ?? (q.refundableOnly ? true : undefined),
      lat: p.gps_coordinates?.latitude,
      lng: p.gps_coordinates?.longitude,
      bookingUrl: p.link ?? url,
      propertyToken: p.property_token,
      raw: p,
    });
  }
  return offers;
}

export class SerpApiHotelProvider implements HotelProvider {
  readonly info;
  private readonly opts: SerpApiHotelOptions;

  constructor(opts: SerpApiHotelOptions) {
    this.opts = opts;
    this.info = { name: "serpapi_google_hotels", tier: "free" as const, configured: !!opts.apiKey, envKeys: ["SERPAPI_KEY"] };
  }

  async search(q: HotelQuery): Promise<ProviderResult<HotelOffer>> {
    const name = this.info.name;
    if (!this.opts.apiKey) return { ok: false, provider: name, error: "SERPAPI_KEY not set", notConfigured: true };
    const key = hotelQueryKey(name, q);
    const hit = await this.opts.cache?.get(key, SIX_HOURS_MS);
    if (hit) {
      const json = hit.response as SerpHotelsResponse;
      return { ok: true, provider: name, offers: parseSerpHotels(json, q), raw: json, fetchedAt: hit.fetchedAt, cached: true, searchUrl: json.search_metadata?.google_hotels_url };
    }
    try {
      const json = await serpApiGet<SerpHotelsResponse>(serpHotelParams(q, this.opts.apiKey), this.opts);
      await this.opts.cache?.set(key, name, json);
      return { ok: true, provider: name, offers: parseSerpHotels(json, q), raw: json, fetchedAt: new Date(), cached: false, searchUrl: json.search_metadata?.google_hotels_url };
    } catch (e) {
      return { ok: false, provider: name, error: (e as Error).message };
    }
  }
}
