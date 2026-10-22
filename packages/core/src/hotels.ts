// Hotels for the exact trip nights (spec §3, §7): refundable rates, quality floors, rebook alerts.
import { diffDays, type ISODate } from "./dates";
import { baselineWindow, dateVariants, nights, variantLabel, type TravelWindow } from "./windows";

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
  /** "rentals" searches Google's vacation rentals (Airbnb/VRBO-style listings). */
  lodging?: "hotels" | "rentals";
}

export interface HotelOffer {
  provider: string;
  name: string;
  pricePerNight: number;
  total: number;
  currency: string;
  stars?: number;
  /** "vacation rental" etc.; undefined for regular hotels. */
  lodgingType?: string;
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
  /** A specific hotel to price on every date card ("My hotel"). */
  pinned?: { name: string };
  /** Also price vacation rentals on every date card. */
  includeRentals?: boolean;
}

/** The hotel pick a date card uses. */
export type HotelTier = "cheapest" | "value" | "rated" | "pinned" | "rental";

export const HOTEL_TIER_LABEL: Record<HotelTier, string> = {
  cheapest: "Cheapest",
  value: "Best value",
  rated: "Best rated",
  pinned: "My hotel",
  rental: "Rental",
};

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
  return [provider, q.location.toLowerCase(), q.checkIn, q.checkOut, q.adults, q.minStars, q.refundableOnly ? "R" : "", q.currency, q.lodging ?? "hotels"].join("|");
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

/**
 * Cheapest, best value and best rated from eligible offers (already sorted cheapest first).
 * Best value = the highest-rated hotel within 25% of the cheapest; best rated = highest rating overall.
 */
export function pickHotelTiers(eligible: HotelOffer[]): Partial<Record<"cheapest" | "value" | "rated", HotelOffer>> {
  if (!eligible.length) return {};
  const cheapest = eligible[0];
  const better = (a: HotelOffer, b: HotelOffer) =>
    (a.rating5 ?? 0) - (b.rating5 ?? 0) || (a.stars ?? 0) - (b.stars ?? 0) || b.total - a.total;
  const pickMax = (list: HotelOffer[]) => list.reduce((best, o) => (better(o, best) > 0 ? o : best));
  const value = pickMax(eligible.filter((o) => o.total <= cheapest.total * 1.25));
  const rated = pickMax(eligible);
  return { cheapest, value, rated };
}

export function normalizeHotelName(s?: string): string {
  return (s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}

/** Find a pinned hotel in search results (exact or contained name match). */
export function findPinnedHotel(offers: HotelOffer[], pinnedName: string): HotelOffer | null {
  const want = normalizeHotelName(pinnedName);
  if (!want) return null;
  return (
    offers.find((o) => normalizeHotelName(o.name) === want) ??
    offers.find((o) => normalizeHotelName(o.name).includes(want) || want.includes(normalizeHotelName(o.name))) ??
    null
  );
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
  const norm = normalizeHotelName;
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

export type HotelSearchKind = "list" | "pinned" | "rental";

/** Key for "when did we last search this": exact nights + kind of search. */
export function hotelFetchKey(arrive: ISODate, depart: ISODate, kind: HotelSearchKind): string {
  return `${arrive}_${depart}|${kind}`;
}

export interface HotelPlannerItem {
  lineItemId: string;
  location: string;
  /** City used to find a pinned hotel by name. */
  city?: string;
  pinnedName?: string;
  includeRentals?: boolean;
  /** Date cards are built around this window (± flex). */
  anchor: TravelWindow;
  /** The trip's currently chosen dates. */
  chosen: TravelWindow;
  flexDays: number;
  event?: { start: ISODate; end: ISODate };
  /** Keys from hotelFetchKey(), plus "baseline". */
  lastFetched: Record<string, Date | undefined>;
  isPeak: (w: TravelWindow) => boolean;
  /** Booked refundable stays: only the booked nights are watched (for rebook alerts). */
  watchingBooked?: boolean;
}

export interface PlannedHotelQuery {
  lineItemId: string;
  /** Date label relative to the anchor ("base", "-1/+0") or "baseline". */
  variant: string;
  search: HotelSearchKind;
  isBaseline: boolean;
  query: HotelQuery;
  priority: number;
}

const KIND_WEIGHT: Record<HotelSearchKind, number> = { list: 1, pinned: 0.85, rental: 0.6 };

/**
 * Hotel searches for today: every date card's nights (± flex around the anchor), for the
 * hotel list, the pinned hotel and rentals. Chosen dates first, then nearest variants.
 */
export function planHotelQueries(
  items: HotelPlannerItem[],
  opts: { today: ISODate; now?: Date; budget: number; minStars: number; minHoursBetween?: number },
): PlannedHotelQuery[] {
  const now = opts.now ?? new Date();
  const minHours = opts.minHoursBetween ?? 20;
  const out: PlannedHotelQuery[] = [];
  for (const it of items) {
    const daysOut = diffDays(opts.today, it.chosen.arrive);
    if (daysOut < 0 || nights(it.chosen) <= 0) continue;
    const urgency = daysOut <= 21 ? 2 : daysOut <= 60 ? 1.5 : daysOut <= 150 ? 1 : 0.6;
    const mk = (w: TravelWindow, kind: HotelSearchKind): HotelQuery => ({
      location: kind === "pinned" ? `${it.pinnedName}${it.city ? `, ${it.city}` : ""}` : it.location,
      checkIn: w.arrive,
      checkOut: w.depart,
      adults: 1,
      minStars: kind === "list" ? opts.minStars : 0,
      refundableOnly: true,
      currency: "USD",
      lodging: kind === "rental" ? "rentals" : "hotels",
    });
    const kinds: HotelSearchKind[] = ["list", ...(it.pinnedName ? (["pinned"] as const) : []), ...(it.includeRentals && !it.watchingBooked ? (["rental"] as const) : [])];

    // Windows: the chosen dates, plus every card around the anchor (not for booked stays).
    const windows: { w: TravelWindow; label: string; weight: number }[] = [
      { w: it.chosen, label: variantLabel(diffDays(it.anchor.arrive, it.chosen.arrive), diffDays(it.anchor.depart, it.chosen.depart)), weight: 110 },
    ];
    if (!it.watchingBooked) {
      for (const v of dateVariants(it.anchor, it.flexDays, it.event)) {
        if (v.arrive === it.chosen.arrive && v.depart === it.chosen.depart) continue;
        if (diffDays(opts.today, v.arrive) < 0) continue;
        const dist = Math.abs(v.outShift) + Math.abs(v.retShift);
        windows.push({ w: v, label: v.label, weight: dist === 0 ? 100 : dist === 1 ? 55 : dist === 2 ? 40 : 25 });
      }
    }

    for (const { w, label, weight } of windows) {
      for (const kind of kinds) {
        const last = it.lastFetched[hotelFetchKey(w.arrive, w.depart, kind)];
        const hours = last ? (now.getTime() - last.getTime()) / 3_600_000 : Infinity;
        if (hours < minHours) continue;
        out.push({
          lineItemId: it.lineItemId,
          variant: label,
          search: kind,
          isBaseline: false,
          query: mk(w, kind),
          priority: weight * KIND_WEIGHT[kind] * urgency + (it.watchingBooked ? 20 : 0) + Math.min(30, Number.isFinite(hours) ? (hours / 24) * 8 : 30),
        });
      }
    }

    const lastBase = it.lastFetched["baseline"];
    if (!it.watchingBooked && (!lastBase || now.getTime() - lastBase.getTime() >= 7 * 86_400_000)) {
      out.push({
        lineItemId: it.lineItemId,
        variant: "baseline",
        search: "list",
        isBaseline: true,
        query: mk(baselineWindow(it.chosen, it.isPeak), "list"),
        priority: lastBase ? 35 : 70,
      });
    }
  }
  return out.sort((a, b) => b.priority - a.priority).slice(0, Math.max(0, opts.budget));
}
