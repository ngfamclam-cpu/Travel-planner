// Hotels for the exact trip nights (spec §3, §7): refundable rates, quality floors, rebook alerts.
import { diffDays, type ISODate } from "./dates";
import { baselineWindow, nights, type TravelWindow } from "./windows";

export interface HotelQuery {
  /** Free-text area, e.g. "hotels near Bayfront Park, Miami". */
  location: string;
  checkIn: ISODate;
  checkOut: ISODate;
  adults: number;
  minStars: number;
  /** Only free-cancellation rates (spec §7: book refundable early, re-check daily). */
  refundableOnly: boolean;
  currency: string;
}

export interface HotelOffer {
  provider: string;
  name: string;
  pricePerNight: number;
  total: number;
  currency: string;
  stars?: number;
  /** Rating out of 5 (Google scale). */
  rating5?: number;
  reviews?: number;
  refundable?: boolean;
  lat?: number;
  lng?: number;
  bookingUrl?: string;
  propertyToken?: string;
  raw?: unknown;
}

export interface HotelSearchSpec {
  /** Overrides the default "hotels near {venue}, {city}". */
  query?: string;
}

/** What the user booked, for rebook alerts. */
export interface HotelBooking {
  hotelName?: string;
  stars?: number;
  rating5?: number;
  refundable?: boolean;
  /** Last day free cancellation is allowed. */
  cancelBy?: ISODate;
  confirmation?: string;
}

export interface HotelFloors {
  minStars: number;
  minRating10: number;
}

export function hotelQueryKey(provider: string, q: HotelQuery): string {
  return [provider, q.location.toLowerCase(), q.checkIn, q.checkOut, q.adults, q.minStars, q.refundableOnly ? "R" : "", q.currency].join("|");
}

export function defaultHotelLocation(event: { venue?: string | null; city: string } | null, fallback?: string): string | null {
  if (event?.venue && event.venue !== "TBA") return `hotels near ${event.venue}, ${event.city}`;
  if (event?.city) return `hotels in ${event.city}`;
  return fallback ?? null;
}

export function googleHotelsUrl(location: string, checkIn: ISODate, checkOut: ISODate): string {
  return `https://www.google.com/travel/search?q=${encodeURIComponent(`${location} ${checkIn} to ${checkOut}`)}`;
}

/** Offers that meet the quality floors, cheapest stay first (rating breaks ties). */
export function eligibleHotels(offers: HotelOffer[], floors: HotelFloors, refundableOnly = true): HotelOffer[] {
  const minRating5 = floors.minRating10 / 2;
  return offers
    .filter((o) => o.total > 0)
    .filter((o) => o.stars == null || o.stars >= floors.minStars)
    .filter((o) => o.rating5 == null || o.rating5 >= minRating5)
    .filter((o) => !refundableOnly || o.refundable !== false)
    .sort((a, b) => a.total - b.total || (b.rating5 ?? 0) - (a.rating5 ?? 0));
}

export interface RebookCandidate {
  offer: HotelOffer;
  savings: number;
  sameHotel: boolean;
}

/**
 * Spec §7 rebook alert: a cheaper refundable rate for the same or a better hotel.
 * "Better" = stars and rating at least as high as what's booked (unknown values don't block).
 */
export function rebookCandidate(
  booking: HotelBooking,
  bookedTotal: number,
  offers: HotelOffer[],
  opts: { today: ISODate; minSavings?: number; minSavingsPct?: number },
): RebookCandidate | null {
  if (!booking.refundable) return null;
  if (booking.cancelBy && booking.cancelBy < opts.today) return null;
  const threshold = Math.max(opts.minSavings ?? 20, bookedTotal * (opts.minSavingsPct ?? 0.05));
  const norm = (s?: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  let best: RebookCandidate | null = null;
  for (const o of offers) {
    if (o.refundable === false) continue;
    const sameHotel = !!booking.hotelName && norm(o.name) === norm(booking.hotelName);
    const asGood =
      sameHotel ||
      ((booking.stars == null || (o.stars ?? 0) >= booking.stars) && (booking.rating5 == null || (o.rating5 ?? 0) >= booking.rating5));
    if (!asGood) continue;
    const savings = Math.round((bookedTotal - o.total) * 100) / 100;
    if (savings >= threshold && (!best || savings > best.savings)) best = { offer: o, savings, sameHotel };
  }
  return best;
}

export interface HotelPlannerItem {
  lineItemId: string;
  location: string;
  window: TravelWindow;
  lastFetched: Record<string, Date | undefined>;
  isPeak: (w: TravelWindow) => boolean;
  /** Booked refundable stays are watched for rebook alerts. */
  watchingBooked?: boolean;
}

export interface PlannedHotelQuery {
  lineItemId: string;
  variant: "base" | "baseline";
  isBaseline: boolean;
  query: HotelQuery;
  priority: number;
}

export function planHotelQueries(
  items: HotelPlannerItem[],
  opts: { today: ISODate; now?: Date; budget: number; minStars: number; minHoursBetween?: number },
): PlannedHotelQuery[] {
  const now = opts.now ?? new Date();
  const minHours = opts.minHoursBetween ?? 20;
  const out: PlannedHotelQuery[] = [];
  for (const it of items) {
    const daysOut = diffDays(opts.today, it.window.arrive);
    if (daysOut < 0 || nights(it.window) <= 0) continue;
    const urgency = daysOut <= 21 ? 2 : daysOut <= 60 ? 1.5 : daysOut <= 150 ? 1 : 0.6;
    const mk = (w: TravelWindow): HotelQuery => ({
      location: it.location,
      checkIn: w.arrive,
      checkOut: w.depart,
      adults: 1,
      minStars: opts.minStars,
      refundableOnly: true,
      currency: "USD",
    });
    const last = it.lastFetched["base"];
    const hours = last ? (now.getTime() - last.getTime()) / 3_600_000 : Infinity;
    if (hours >= minHours) {
      out.push({
        lineItemId: it.lineItemId,
        variant: "base",
        isBaseline: false,
        query: mk(it.window),
        priority: 100 * urgency + (it.watchingBooked ? 20 : 0) + Math.min(30, Number.isFinite(hours) ? (hours / 24) * 8 : 30),
      });
    }
    const lastBase = it.lastFetched["baseline"];
    if (!it.watchingBooked && (!lastBase || now.getTime() - lastBase.getTime() >= 7 * 86_400_000)) {
      out.push({ lineItemId: it.lineItemId, variant: "baseline", isBaseline: true, query: mk(baselineWindow(it.window, it.isPeak)), priority: lastBase ? 35 : 70 });
    }
  }
  return out.sort((a, b) => b.priority - a.priority).slice(0, Math.max(0, opts.budget));
}
