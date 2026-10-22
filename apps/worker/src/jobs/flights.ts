// Step 3: daily flight snapshots for every active trip, priced on the event window (spec §3).
import {
  cheapestWithPositioning,
  dailyBudget,
  destinationFromAirports,
  isPeakWindow,
  planFlightQueries,
  positioningCostFor,
  searchOrigins,
  toISODate,
  todayIn,
  type Destination,
  type FlightSearchSpec,
  type PlannerItem,
} from "@rave-run/core";
import type { Prisma, PrismaClient } from "@rave-run/db";
import type { FlightProvider } from "@rave-run/providers";
import { loadSettings } from "../settings";
import { refreshLineItemQuote } from "./quotes";

export interface FlightJobOptions {
  now?: Date;
  /** Pause between live searches so we never hammer the source (spec §5). */
  pauseMs?: number;
  /** Override the computed daily budget (e.g. for a manual run). */
  budget?: number;
  log?: (msg: string) => void;
}

export interface FlightJobResult {
  ok: boolean;
  planned: number;
  searched: number;
  snapshots: number;
  failures: string[];
  skippedReason?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runFlightJob(prisma: PrismaClient, provider: FlightProvider, opts: FlightJobOptions = {}): Promise<FlightJobResult> {
  const log = opts.log ?? console.log;
  const now = opts.now ?? new Date();
  const today = todayIn("America/New_York", now);
  const settings = await loadSettings(prisma);
  const providerName = provider.info.name;

  if (!provider.info.configured) {
    const error = `${provider.info.envKeys.join(", ")} not set`;
    await prisma.providerRun.create({ data: { provider: providerName, kind: "flight", ok: false, error } });
    log(error);
    return { ok: false, planned: 0, searched: 0, snapshots: 0, failures: [error], skippedReason: error };
  }

  // Quota: spread what's left of this month's flight allowance over the remaining days.
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const used = await prisma.providerRun.aggregate({
    where: { provider: providerName, startedAt: { gte: monthStart } },
    _sum: { queries: true },
  });
  const allowance = Math.floor(settings.serpapiMonthlyQuota * settings.flightQuotaShare);
  const budget = opts.budget ?? dailyBudget(allowance, used._sum.queries ?? 0, today);

  const items = await prisma.lineItem.findMany({
    where: {
      kind: "flight",
      bookedAmount: null,
      trip: { status: { in: ["considering", "planned"] }, arriveDate: { gte: new Date(`${today}T00:00:00Z`) } },
    },
    include: { trip: { include: { event: true } } },
  });

  const plannerItems: PlannerItem[] = [];
  for (const li of items) {
    const spec = li.searchSpec as FlightSearchSpec | null;
    if (!spec?.destinations?.length) continue;
    const last = await prisma.priceSnapshot.groupBy({
      by: ["variant"],
      where: { lineItemId: li.id },
      _max: { fetchedAt: true },
    });
    const ev = li.trip.event;
    const dest: Destination = ev
      ? { country: ev.country, city: ev.city, airports: spec.destinations }
      : destinationFromAirports(spec.destinations);
    const arrive = toISODate(li.trip.arriveDate);
    const depart = toISODate(li.trip.departDate);
    const evStart = ev ? toISODate(ev.startDate) : undefined;
    const evEnd = ev ? toISODate(ev.endDate) : undefined;
    plannerItems.push({
      lineItemId: li.id,
      spec,
      window: { arrive, depart },
      flexDays: li.trip.flexDays,
      // Only constrain variants by the event when the trip actually covers it.
      event: evStart && evEnd && arrive <= evStart && depart >= evEnd ? { start: evStart, end: evEnd } : undefined,
      lastFetched: Object.fromEntries(last.map((r) => [r.variant ?? "base", r._max.fetchedAt ?? undefined])),
      isPeak: (w) => isPeakWindow({ start: w.arrive, end: w.depart }, dest),
    });
  }

  const plan = planFlightQueries(plannerItems, {
    today,
    now,
    budget,
    defaultOrigins: searchOrigins(settings),
  });
  log(`Flights: ${plannerItems.length} items, budget ${budget}, running ${plan.length} searches`);

  let searched = 0;
  let quotaSpent = 0;
  let snapshots = 0;
  const failures: string[] = [];
  const touched = new Set<string>();

  for (const [i, pq] of plan.entries()) {
    const res = await provider.search(pq.query);
    searched++;
    if (!res.ok) {
      failures.push(`${pq.query.destinations.join("/")} ${pq.query.outboundDate}→${pq.query.returnDate}: ${res.error}`);
      continue;
    }
    if (!res.cached) quotaSpent += "searchesPerQuery" in provider ? (provider as { searchesPerQuery(q: unknown): number }).searchesPerQuery(pq.query) : 1;

    const best = cheapestWithPositioning(res.offers, (a) => positioningCostFor(settings, a));
    if (best) {
      await prisma.priceSnapshot.create({
        data: {
          lineItemId: pq.lineItemId,
          query: pq.query as unknown as Prisma.InputJsonValue,
          variant: pq.variant,
          isBaseline: pq.isBaseline,
          provider: res.provider,
          price: best.price,
          positioningCost: best.positioningCost,
          totalPrice: best.total,
          currency: best.currency,
          origin: best.origin,
          destination: best.destination,
          outboundDate: new Date(`${pq.query.outboundDate}T00:00:00Z`),
          returnDate: new Date(`${pq.query.returnDate}T00:00:00Z`),
          cabin: pq.query.cabin,
          stops: best.stops,
          carrier: best.carrier,
          insightLabel: best.insightLabel,
          bookingUrl: res.searchUrl ?? best.bookingUrl,
          fetchedAt: res.fetchedAt,
          raw: res.raw as Prisma.InputJsonValue,
        },
      });
      snapshots++;
      touched.add(pq.lineItemId);
    } else {
      failures.push(`${pq.query.destinations.join("/")} ${pq.query.outboundDate}: no offers returned`);
    }
    if (!res.cached && i < plan.length - 1 && opts.pauseMs) await sleep(opts.pauseMs);
  }

  for (const id of touched) await refreshLineItemQuote(prisma, id, now);

  await prisma.providerRun.create({
    data: {
      provider: providerName,
      kind: "flight",
      ok: failures.length === 0 || snapshots > 0,
      queries: quotaSpent,
      results: snapshots,
      error: failures.length ? failures.slice(0, 10).join("\n") : null,
    },
  });
  log(`Flights: ${snapshots} snapshots, ${failures.length} failures, ${quotaSpent} searches spent`);
  return { ok: failures.length === 0, planned: plan.length, searched, snapshots, failures };
}
