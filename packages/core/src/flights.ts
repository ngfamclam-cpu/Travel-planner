// Flight query types and the daily query planner (spec §3, §5).
import { cityForAirports } from "./airports";
import { diffDays, parseISODate, type ISODate } from "./dates";
import { baselineWindow, dateVariants, variantLabel, type DateVariant, type TravelWindow } from "./windows";

export interface FlightQuery {
  origins: string[]; // searched together, e.g. ["BOS","PVD","MHT","JFK","EWR","LGA"]
  destinations: string[]; // e.g. ["MIA","FLL"]
  outboundDate: ISODate;
  returnDate: ISODate;
  adults: number;
  cabin: "economy" | "premium_economy" | "business" | "first";
  currency: string;
}

export interface FlightOffer {
  provider: string;
  price: number;
  currency: string;
  origin: string;
  destination: string;
  outboundDate: ISODate;
  returnDate: ISODate;
  stops: number;
  carrier: string;
  durationMinutes?: number;
  /** Google's "prices are currently low/typical/high", when present. */
  insightLabel?: "low" | "typical" | "high";
  typicalRange?: [number, number];
  bookingUrl?: string;
  raw?: unknown;
}

export interface FlightSearchSpec {
  origins?: string[]; // defaults to settings.originAirports
  destinations: string[];
}

export function flightQueryKey(provider: string, q: FlightQuery): string {
  return [
    provider,
    [...q.origins].sort().join(","),
    [...q.destinations].sort().join(","),
    q.outboundDate,
    q.returnDate,
    q.adults,
    q.cabin,
    q.currency,
  ].join("|");
}

/**
 * Google Flights search link, worded by city with the exact dates, e.g.
 * "Flights from Boston to Miami on Mar 25, 2027 through Mar 29, 2027". The app never buys (spec §11).
 */
export function googleFlightsUrl(q: {
  origins?: string[];
  destinations?: string[];
  fromCity?: string;
  toCity?: string;
  outboundDate: ISODate;
  returnDate: ISODate;
}): string {
  const from = q.fromCity || cityForAirports(q.origins?.length ? [q.origins[0]] : ["BOS"]);
  const to = q.toCity || cityForAirports(q.destinations ?? []);
  const day = (iso: ISODate) =>
    parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const text = `Flights from ${from} to ${to} on ${day(q.outboundDate)} through ${day(q.returnDate)}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(text)}&curr=USD&hl=en`;
}

export interface PlannerItem {
  lineItemId: string;
  spec: FlightSearchSpec;
  /** Date cards are built around this window (± flex). */
  window: TravelWindow;
  /** The trip's chosen dates, always searched first (defaults to the window). */
  chosen?: TravelWindow;
  flexDays: number;
  event?: { start: ISODate; end: ISODate };
  /**
   * Origins for the other date cards. When every airport costs a request (free source),
   * the job passes BOS plus whichever airport won last time, instead of all six.
   */
  variantOrigins?: string[];
  /** Last fetch time per variant label ("base", "-1/+1", "baseline"). */
  lastFetched: Record<string, Date | undefined>;
  isPeak: (w: TravelWindow) => boolean;
}

export interface PlannedQuery {
  lineItemId: string;
  variant: string;
  isBaseline: boolean;
  query: FlightQuery;
  priority: number;
}

export interface PlanOptions {
  today: ISODate;
  now?: Date;
  budget: number;
  defaultOrigins: string[];
  /** Don't re-run a variant fetched more recently than this. */
  minHoursBetween?: number;
  maxVariantsPerItem?: number;
  /** Quota units a query costs (default 1); the budget is in these units. */
  cost?: (q: FlightQuery) => number;
}

function variantWeight(v: DateVariant): number {
  const dist = Math.abs(v.outShift) + Math.abs(v.retShift);
  return dist === 0 ? 100 : dist === 1 ? 55 : dist === 2 ? 40 : 25;
}

/**
 * Pick today's flight searches within the budget. Base dates always win; flex variants and the
 * surge baseline fill in the rest, favouring trips that are close or haven't been checked lately.
 */
export function planFlightQueries(items: PlannerItem[], opts: PlanOptions): PlannedQuery[] {
  const now = opts.now ?? new Date();
  const minHours = opts.minHoursBetween ?? 20;
  const maxVariants = opts.maxVariantsPerItem ?? 25;
  const candidates: PlannedQuery[] = [];

  for (const item of items) {
    const chosen = item.chosen ?? item.window;
    const daysOut = diffDays(opts.today, chosen.arrive);
    if (daysOut < 0) continue; // trip already started
    const urgency = daysOut <= 21 ? 2 : daysOut <= 60 ? 1.5 : daysOut <= 150 ? 1 : 0.6;
    const origins = item.spec.origins?.length ? item.spec.origins : opts.defaultOrigins;
    const mk = (w: TravelWindow, narrow = false): FlightQuery => ({
      origins: narrow && item.variantOrigins?.length ? item.variantOrigins : origins,
      destinations: item.spec.destinations,
      outboundDate: w.arrive,
      returnDate: w.depart,
      adults: 1,
      cabin: "economy",
      currency: "USD",
    });
    const staleness = (label: string) => {
      const last = item.lastFetched[label];
      if (!last) return { skip: false, bonus: 30 };
      const hours = (now.getTime() - last.getTime()) / 3_600_000;
      return { skip: hours < minHours, bonus: Math.min(30, (hours / 24) * 8) };
    };

    const variants = dateVariants(item.window, item.flexDays, item.event)
      .filter((v) => diffDays(opts.today, v.arrive) >= 0)
      .slice(0, maxVariants);
    const chosenLabel = variantLabel(diffDays(item.window.arrive, chosen.arrive), diffDays(item.window.depart, chosen.depart));
    if (!variants.some((v) => v.label === chosenLabel)) {
      variants.unshift({ ...chosen, label: chosenLabel, outShift: 0, retShift: 0 });
    }
    for (const v of variants) {
      const st = staleness(v.label);
      if (st.skip) continue;
      candidates.push({
        lineItemId: item.lineItemId,
        variant: v.label,
        isBaseline: false,
        query: mk(v, v.label !== chosenLabel),
        priority: (v.label === chosenLabel ? 110 : variantWeight(v)) * urgency + st.bonus,
      });
    }

    // Baseline for the surge figure: refresh weekly.
    const lastBase = item.lastFetched["baseline"];
    const baseAgeDays = lastBase ? (now.getTime() - lastBase.getTime()) / 86_400_000 : Infinity;
    if (baseAgeDays >= 7) {
      candidates.push({
        lineItemId: item.lineItemId,
        variant: "baseline",
        isBaseline: true,
        query: mk(baselineWindow(chosen, item.isPeak), true),
        priority: lastBase ? 35 : 70,
      });
    }
  }

  // Highest priority first, until the budget (in cost units) runs out; cheaper queries can still fit.
  const out: PlannedQuery[] = [];
  let left = Math.max(0, opts.budget);
  for (const c of candidates.sort((a, b) => b.priority - a.priority)) {
    const cost = opts.cost ? opts.cost(c.query) : 1;
    if (cost <= left) {
      out.push(c);
      left -= cost;
    }
  }
  return out;
}

/** Spread the remaining monthly allowance evenly over the days left in the month. */
export function dailyBudget(monthlyAllowance: number, usedThisMonth: number, today: ISODate): number {
  const d = parseISODate(today);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const daysLeft = daysInMonth - d.getUTCDate() + 1;
  const remaining = Math.max(0, monthlyAllowance - usedThisMonth);
  return Math.floor(remaining / daysLeft);
}

/** Cheapest offer across date variants, after adding positioning costs per origin airport. */
export function cheapestWithPositioning<T extends { price: number; origin: string }>(
  offers: T[],
  positioning: (airport: string) => number,
): (T & { positioningCost: number; total: number }) | null {
  let best: (T & { positioningCost: number; total: number }) | null = null;
  for (const o of offers) {
    const positioningCost = positioning(o.origin);
    const total = o.price + positioningCost;
    if (!best || total < best.total) best = { ...o, positioningCost, total };
  }
  return best;
}
