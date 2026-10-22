// Keep a line item's quote in sync with its snapshots (spec §14: never older than 48h).
// Quotes are for the trip's chosen dates; the date cards show the alternatives.
import type { Prisma, PrismaClient } from "@prisma/client";
import { HOTEL_TIER_LABEL, toISODate, type HotelTier } from "@rave-run/core";

export interface ChosenOption {
  /** Date cards are built around this window (set the first time a card is chosen). */
  anchor?: { arrive: string; depart: string };
  hotelTier?: HotelTier;
}

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

type Snap = Prisma.PriceSnapshotGetPayload<object>;

function describe(s: Snap, kind: string): string {
  if (kind === "hotel") {
    const bits = [s.hotelName, s.stars ? `${s.stars}★` : null, s.rating ? `${s.rating}/5` : null, s.refundable ? "free cancellation" : null].filter(Boolean);
    const tier = s.tier ? `${HOTEL_TIER_LABEL[s.tier as HotelTier] ?? s.tier}: ` : "";
    return `Google Hotels via SerpApi (${tier}${bits.join(", ")})`;
  }
  const pos = Number(s.positioningCost);
  const via = pos > 0 ? ` from ${s.origin} incl. $${pos} positioning` : ` from ${s.origin}`;
  return `Google Flights via SerpApi (${via.trim()}, ${s.carrier}, ${s.stops === 0 ? "nonstop" : `${s.stops} stop`})`;
}

/**
 * Quote = the cheapest snapshot from the last 48h for the trip's exact dates.
 * Hotels use the chosen tier (falling back to cheapest) and quote per night (qty = nights);
 * flights quote the whole round trip including positioning.
 */
export async function refreshLineItemQuote(prisma: PrismaClient, lineItemId: string, now = new Date()) {
  const li = await prisma.lineItem.findUniqueOrThrow({ where: { id: lineItemId }, include: { trip: true } });
  const arrive = toISODate(li.trip.arriveDate);
  const depart = toISODate(li.trip.departDate);
  const since = new Date(now.getTime() - 48 * 3_600_000);
  const where: Prisma.PriceSnapshotWhereInput = {
    lineItemId,
    isBaseline: false,
    fetchedAt: { gte: since },
    outboundDate: day(arrive),
    returnDate: day(depart),
  };
  let best: Snap | null = null;
  if (li.kind === "hotel") {
    const tier = ((li.trip.chosenOption ?? {}) as ChosenOption).hotelTier ?? "cheapest";
    best =
      (await prisma.priceSnapshot.findFirst({ where: { ...where, tier }, orderBy: { fetchedAt: "desc" } })) ??
      (await prisma.priceSnapshot.findFirst({ where: { ...where, tier: "cheapest" }, orderBy: { fetchedAt: "desc" } }));
  } else {
    best = await prisma.priceSnapshot.findFirst({ where, orderBy: [{ totalPrice: "asc" }, { fetchedAt: "desc" }] });
  }
  const baseline = await prisma.priceSnapshot.findFirst({ where: { lineItemId, isBaseline: true }, orderBy: { fetchedAt: "desc" } });
  const perUnit = (s: Snap) => (li.kind === "hotel" ? s.price : s.totalPrice);

  const data: Prisma.LineItemUpdateInput = {};
  if (best) {
    Object.assign(data, {
      quotedAmount: perUnit(best),
      quotedAt: best.fetchedAt,
      quotedSource: describe(best, li.kind),
      quotedUrl: best.bookingUrl,
      insightLabel: best.insightLabel,
      isEstimate: false,
    });
  }
  if (baseline) Object.assign(data, { baselinePrice: perUnit(baseline), baselineAt: baseline.fetchedAt });
  if (Object.keys(data).length) await prisma.lineItem.update({ where: { id: lineItemId }, data });
  return !!best;
}

/** Re-quote every flight/hotel on a trip (after its dates or hotel pick change). */
export async function refreshTripQuotes(prisma: PrismaClient, tripId: string, now = new Date()) {
  const items = await prisma.lineItem.findMany({ where: { tripId, kind: { in: ["flight", "hotel"] } } });
  for (const li of items) {
    const found = await refreshLineItemQuote(prisma, li.id, now);
    // No price yet for the new dates: clear the old one rather than show a quote for other dates.
    if (!found && li.quotedAmount != null && li.quotedSource?.includes("via SerpApi")) {
      await prisma.lineItem.update({
        where: { id: li.id },
        data: { quotedAmount: null, quotedAt: null, quotedSource: null, quotedUrl: null, insightLabel: null, isEstimate: true },
      });
    }
  }
}
