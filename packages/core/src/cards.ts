// Date cards (Google Flights-style): one card per date combination around the anchor window,
// each priced end to end: cheapest flight + a hotel pick for those exact nights + cheapest ticket + fixed costs.
import { diffDays, type ISODate } from "./dates";
import { isStale } from "./freshness";
import type { HotelTier } from "./hotels";
import { dateVariants, nights, variantLabel, type TravelWindow } from "./windows";

export interface FlightSnap {
  arrive: ISODate;
  depart: ISODate;
  total: number; // fare + positioning
  positioningCost: number;
  origin: string | null;
  carrier: string | null;
  stops: number | null;
  insight: string | null;
  url: string | null;
  fetchedAt: Date;
}

export interface HotelSnap {
  arrive: ISODate;
  depart: ISODate;
  tier: HotelTier;
  name: string;
  total: number;
  perNight: number;
  stars: number | null;
  rating5: number | null;
  refundable: boolean | null;
  url: string | null;
  imageUrl?: string | null;
  fetchedAt: Date;
}

export interface CardTicket {
  label: string;
  price: number;
  source: string;
  resale: boolean;
  /** Other tiers to show on the card (GA+, VIP…). */
  others: { label: string; price: number }[];
}

export interface DateCardInput {
  anchor: TravelWindow;
  chosen: TravelWindow;
  flexDays: number;
  event?: { start: ISODate; end: ISODate };
  today: ISODate;
  now?: Date;
  needsFlight: boolean;
  needsHotel: boolean;
  /** Fallback per-night hotel estimate when a card's nights haven't been searched yet. */
  hotelEstPerNight: number | null;
  flights: FlightSnap[];
  hotels: HotelSnap[];
  ticket: CardTicket | null;
  /** Ground, food, etc.: costs that don't depend on the dates. */
  fixedCosts: number;
}

export interface DateCard {
  arrive: ISODate;
  depart: ISODate;
  label: string;
  nights: number;
  isChosen: boolean;
  /** Lands on the event's first day: fine with an early flight, but cutting it close. */
  arrivesOnDayOne: boolean;
  flight: (FlightSnap & { stale: boolean }) | null;
  hotels: Partial<Record<HotelTier, HotelSnap & { stale: boolean }>>;
  hotelEstimate: number | null;
  ticket: CardTicket | null;
  fixed: number;
  needsFlight: boolean;
  needsHotel: boolean;
}

export interface CardPrice {
  total: number;
  complete: boolean;
  /** True when part of the total is an estimate rather than a fetched price. */
  estimated: boolean;
  stale: boolean;
  missing: string[];
  hotel: (HotelSnap & { stale: boolean }) | null;
}

const latestBy = <T extends { fetchedAt: Date }>(rows: T[]): T[] => {
  if (!rows.length) return [];
  const newest = Math.max(...rows.map((r) => r.fetchedAt.getTime()));
  return rows.filter((r) => r.fetchedAt.getTime() === newest);
};

export function buildDateCards(input: DateCardInput): DateCard[] {
  const now = input.now ?? new Date();
  const windows: TravelWindow[] = [input.chosen];
  for (const v of dateVariants(input.anchor, input.flexDays, input.event)) {
    if (!windows.some((w) => w.arrive === v.arrive && w.depart === v.depart)) windows.push(v);
  }
  return windows
    .filter((w) => diffDays(input.today, w.arrive) >= 0 || (w.arrive === input.chosen.arrive && w.depart === input.chosen.depart))
    .map((w) => {
      const same = (s: { arrive: string; depart: string }) => s.arrive === w.arrive && s.depart === w.depart;
      // Flight: cheapest from the most recent search for these exact dates.
      const fl = latestBy(input.flights.filter(same)).sort((a, b) => a.total - b.total)[0] ?? null;
      const hotels: DateCard["hotels"] = {};
      for (const tier of ["cheapest", "value", "rated", "pinned", "rental"] as HotelTier[]) {
        const h = latestBy(input.hotels.filter((s) => same(s) && s.tier === tier))[0];
        if (h) hotels[tier] = { ...h, stale: isStale(h.fetchedAt, now) };
      }
      const n = nights(w);
      return {
        arrive: w.arrive,
        depart: w.depart,
        label: variantLabel(diffDays(input.anchor.arrive, w.arrive), diffDays(input.anchor.depart, w.depart)),
        nights: n,
        isChosen: w.arrive === input.chosen.arrive && w.depart === input.chosen.depart,
        arrivesOnDayOne: !!input.event && w.arrive === input.event.start,
        flight: fl ? { ...fl, stale: isStale(fl.fetchedAt, now) } : null,
        hotels,
        hotelEstimate: input.hotelEstPerNight != null ? Math.round(input.hotelEstPerNight * n * 100) / 100 : null,
        ticket: input.ticket,
        fixed: input.fixedCosts,
        needsFlight: input.needsFlight,
        needsHotel: input.needsHotel,
      };
    });
}

/** Price a card with a given hotel pick. Missing tiers fall back to the estimate, flagged. */
export function priceCard(card: DateCard, tier: HotelTier): CardPrice {
  const missing: string[] = [];
  let total = card.fixed;
  let estimated = false;
  let stale = false;

  if (card.needsFlight) {
    if (card.flight) {
      total += card.flight.total;
      stale ||= card.flight.stale;
    } else missing.push("flight");
  }

  let hotel: CardPrice["hotel"] = null;
  if (card.needsHotel) {
    hotel = card.hotels[tier] ?? null;
    if (hotel) {
      total += hotel.total;
      stale ||= hotel.stale;
    } else if (card.hotelEstimate != null && tier !== "pinned" && tier !== "rental") {
      total += card.hotelEstimate;
      estimated = true;
    } else missing.push(tier === "pinned" ? "my hotel" : tier === "rental" ? "rental" : "hotel");
  }

  if (card.ticket) total += card.ticket.price;

  return { total: Math.round(total * 100) / 100, complete: missing.length === 0, estimated, stale, missing, hotel };
}

/** Complete cards first (cheapest first), then partial ones by what they have. */
export function sortCards(cards: DateCard[], tier: HotelTier): { card: DateCard; price: CardPrice }[] {
  return cards
    .map((card) => ({ card, price: priceCard(card, tier) }))
    .sort(
      (a, b) =>
        Number(b.price.complete) - Number(a.price.complete) ||
        Number(a.price.estimated) - Number(b.price.estimated) ||
        a.price.total - b.price.total,
    );
}

/** Cheapest available ticket: face value on sale first, else the resale floor. */
export function cheapestTicket(
  tiers: { name: string; price: number | null; onSale: boolean; soldOut: boolean; isResale: boolean; source: string }[],
): CardTicket | null {
  const priced = tiers.filter((t) => t.price != null && !t.soldOut) as (typeof tiers[number] & { price: number })[];
  const face = priced.filter((t) => !t.isResale && t.onSale).sort((a, b) => a.price - b.price);
  const resale = priced.filter((t) => t.isResale).sort((a, b) => a.price - b.price);
  const pick = face[0] ?? resale[0];
  if (!pick) return null;
  const others = face.filter((t) => t !== pick).map((t) => ({ label: t.name, price: t.price }));
  if (pick !== resale[0] && resale[0]) others.push({ label: `${resale[0].name}`, price: resale[0].price });
  return { label: pick.name, price: pick.price, source: pick.source, resale: pick.isResale, others };
}
