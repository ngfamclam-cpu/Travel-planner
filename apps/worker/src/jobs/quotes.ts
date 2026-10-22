// Keep a line item's quote in sync with its snapshots (spec §14: never older than 48h, never other dates).
import { addDays, toISODate } from "@rave-run/core";
import type { Prisma, PrismaClient } from "@rave-run/db";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Snapshot dates that still describe this trip: exact nights for hotels, within ±flex for flights. */
export function dateFilter(kind: string, arrive: string, depart: string, flexDays: number): Prisma.PriceSnapshotWhereInput {
  if (kind === "hotel") return { outboundDate: day(arrive), returnDate: day(depart) };
  return {
    outboundDate: { gte: day(addDays(arrive, -flexDays)), lte: day(addDays(arrive, flexDays)) },
    returnDate: { gte: day(addDays(depart, -flexDays)), lte: day(addDays(depart, flexDays)) },
  };
}

function describe(s: { provider: string; variant: string | null; origin: string | null; positioningCost: Prisma.Decimal; carrier: string | null; stops: number | null; hotelName: string | null; stars: number | null; rating: number | null; refundable: boolean | null }, kind: string): string {
  if (kind === "hotel") {
    const bits = [s.hotelName, s.stars ? `${s.stars}★` : null, s.rating ? `${s.rating}/5` : null, s.refundable ? "free cancellation" : null].filter(Boolean);
    return `Google Hotels via SerpApi (${bits.join(", ")})`;
  }
  const pos = Number(s.positioningCost);
  const via = pos > 0 ? ` from ${s.origin} incl. $${pos} positioning` : ` from ${s.origin}`;
  return `Google Flights via SerpApi (${s.variant}${via}, ${s.carrier}, ${s.stops === 0 ? "nonstop" : `${s.stops} stop`})`;
}

/**
 * Quote = cheapest matching snapshot from the last 48h. Hotels quote per night (qty = nights);
 * flights quote the whole round trip including positioning.
 */
export async function refreshLineItemQuote(prisma: PrismaClient, lineItemId: string, now = new Date()) {
  const li = await prisma.lineItem.findUniqueOrThrow({ where: { id: lineItemId }, include: { trip: true } });
  const arrive = toISODate(li.trip.arriveDate);
  const depart = toISODate(li.trip.departDate);
  const since = new Date(now.getTime() - 48 * 3_600_000);
  const best = await prisma.priceSnapshot.findFirst({
    where: { lineItemId, isBaseline: false, fetchedAt: { gte: since }, ...dateFilter(li.kind, arrive, depart, li.trip.flexDays) },
    orderBy: [{ totalPrice: "asc" }, { fetchedAt: "desc" }],
  });
  const baseline = await prisma.priceSnapshot.findFirst({ where: { lineItemId, isBaseline: true }, orderBy: { fetchedAt: "desc" } });
  const perUnit = (s: { price: Prisma.Decimal; totalPrice: Prisma.Decimal }) => (li.kind === "hotel" ? s.price : s.totalPrice);

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
}
