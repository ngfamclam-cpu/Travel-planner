// Step 10: savings meter. On the free tier, re-check up to a couple of flights a day with SerpApi
// (from its free allowance) and record whether it found them cheaper than the free source did.
import { cheapestWithPositioning, mergeSettings, positioningCostFor, todayIn, toISODate, type FlightQuery } from "@rave-run/core";
import { refreshLineItemQuote, type Prisma, type PrismaClient } from "@rave-run/db";
import type { FlightProvider } from "@rave-run/providers";
import { dailyFlightBudget } from "./flights";

export async function runSavingsCheck(prisma: PrismaClient, paid: FlightProvider, opts: { now?: Date; max?: number; log?: (m: string) => void } = {}) {
  const now = opts.now ?? new Date();
  const log = opts.log ?? console.log;
  const today = todayIn("America/New_York", now);
  const settings = mergeSettings(await prisma.setting.findMany());
  if (settings.dataTier === "paid" || !paid.info.configured) return { compared: 0, skipped: settings.dataTier === "paid" ? "paid tier on" : "no SerpApi key" };
  const budget = Math.min(opts.max ?? 2, await dailyFlightBudget(prisma, paid, settings, now, today));
  if (budget <= 0) return { compared: 0, skipped: "no SerpApi searches left today" };

  const dayStart = new Date(`${today}T00:00:00Z`);
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const items = await prisma.lineItem.findMany({
    where: { kind: "flight", included: true, bookedAmount: null, trip: { status: { in: ["planned", "booked", "considering"] }, departDate: { gte: dayStart } } },
    include: { trip: true, savings: { where: { date: dayStart } } },
  });
  // Planned trips first, soonest first.
  items.sort((a, b) => Number(b.trip.status !== "considering") - Number(a.trip.status !== "considering") || a.trip.arriveDate.getTime() - b.trip.arriveDate.getTime());

  let compared = 0;
  let spent = 0;
  for (const li of items) {
    if (compared >= budget) break;
    if (li.savings.length) continue;
    const free = await prisma.priceSnapshot.findFirst({
      where: { lineItemId: li.id, provider: "google_flights_free", isBaseline: false, fetchedAt: { gte: since }, outboundDate: li.trip.arriveDate, returnDate: li.trip.departDate },
      orderBy: { totalPrice: "asc" },
    });
    if (!free) continue;
    const query = free.query as unknown as FlightQuery;
    const res = await paid.search(query);
    if (!res.ok) {
      log(`Savings check: ${li.trip.name}: ${res.error}`);
      continue;
    }
    if (!res.cached) spent += paid.cost ? paid.cost(query) : 1;
    const best = cheapestWithPositioning(res.offers, (a) => positioningCostFor(settings, a));
    if (!best) continue;
    await prisma.priceSnapshot.create({
      data: {
        lineItemId: li.id,
        query: query as unknown as Prisma.InputJsonValue,
        variant: free.variant,
        provider: res.provider,
        price: best.price,
        positioningCost: best.positioningCost,
        totalPrice: best.total,
        currency: best.currency,
        origin: best.origin,
        destination: best.destination,
        outboundDate: li.trip.arriveDate,
        returnDate: li.trip.departDate,
        cabin: query.cabin,
        stops: best.stops,
        carrier: best.carrier,
        insightLabel: best.insightLabel,
        bookingUrl: res.searchUrl ?? best.bookingUrl,
        fetchedAt: res.fetchedAt,
        raw: res.raw as Prisma.InputJsonValue,
      },
    });
    await prisma.savingsMeter.create({ data: { date: dayStart, lineItemId: li.id, freeBestPrice: free.totalPrice, paidBestPrice: best.total } });
    // The paid price is real data too: if it's cheaper, the trip's quote uses it.
    await refreshLineItemQuote(prisma, li.id, now);
    compared++;
    log(`Savings check: ${li.trip.name} ${toISODate(li.trip.arriveDate)}: free $${Number(free.totalPrice)} vs paid $${best.total}`);
  }
  if (spent) await prisma.providerRun.create({ data: { provider: paid.info.name, kind: "flight", ok: true, queries: spent, results: compared } });
  return { compared };
}
