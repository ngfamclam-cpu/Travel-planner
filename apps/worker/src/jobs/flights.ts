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
  type AppSettings,
  type Destination,
  type FlightQuery,
  type FlightSearchSpec,
  type PlannerItem,
} from "@rave-run/core";
import type { Prisma, PrismaClient } from "@rave-run/db";
import type { FlightProvider } from "@rave-run/providers";
import { loadSettings } from "../settings";
import { refreshLineItemQuote, type ChosenOption } from "@rave-run/db";

export interface FlightJobOptions {
  now?: Date;
  /** Pause between live searches so we never hammer the source (spec §5). */
  pauseMs?: number;
  /** Override the computed daily budget (e.g. for a manual run). */
  budget?: number;
  /** Used for the rest of the run when the primary source keeps failing (e.g. free source blocked). */
  fallback?: FlightProvider;
  /** Consecutive primary failures before switching to the fallback. */
  failoverAfter?: number;
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

  const budget = opts.budget ?? (await dailyFlightBudget(prisma, provider, settings, now, today));

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
    const chosen = { arrive: toISODate(li.trip.arriveDate), depart: toISODate(li.trip.departDate) };
    // Cards stay anchored to the window they were first built around.
    const anchor = ((li.trip.chosenOption ?? {}) as ChosenOption).anchor ?? chosen;
    const { arrive, depart } = anchor;
    const evStart = ev ? toISODate(ev.startDate) : undefined;
    const evEnd = ev ? toISODate(ev.endDate) : undefined;
    // When every airport costs a request, other date cards search BOS + last winner only.
    let variantOrigins: string[] | undefined;
    if (provider.info.costPerPair) {
      const winner = await prisma.priceSnapshot.findFirst({
        where: { lineItemId: li.id, isBaseline: false, fetchedAt: { gte: new Date(now.getTime() - 14 * 86_400_000) } },
        orderBy: { totalPrice: "asc" },
        select: { origin: true },
      });
      const all = spec.origins?.length ? spec.origins : searchOrigins(settings);
      variantOrigins = [...new Set([all.includes("BOS") ? "BOS" : all[0], ...(winner?.origin && all.includes(winner.origin) ? [winner.origin] : [])])];
    }
    plannerItems.push({
      lineItemId: li.id,
      spec,
      window: anchor,
      chosen,
      variantOrigins,
      flexDays: li.trip.flexDays,
      // Only constrain variants by the event when the trip actually covers it.
      event: evStart && evEnd && arrive <= evStart && depart >= evEnd ? { start: evStart, end: evEnd } : undefined,
      lastFetched: Object.fromEntries(last.map((r) => [r.variant ?? "base", r._max.fetchedAt ?? undefined])),
      isPeak: (w) => isPeakWindow({ start: w.arrive, end: w.depart }, dest),
    });
  }

  const costOf = (p: FlightProvider) => (q: FlightQuery) => (p.cost ? p.cost(q) : 1);
  const plan = planFlightQueries(plannerItems, {
    today,
    now,
    budget,
    defaultOrigins: searchOrigins(settings),
    cost: costOf(provider),
  });
  log(`Flights: ${plannerItems.length} items, ${providerName} budget ${budget}, running ${plan.length} searches`);

  let searched = 0;
  let snapshots = 0;
  const failures: string[] = [];
  const touched = new Set<string>();
  // Per-source accounting (the fallback has its own quota).
  const spent = new Map<string, { queries: number; results: number; failures: string[] }>();
  const account = (name: string) => spent.get(name) ?? (spent.set(name, { queries: 0, results: 0, failures: [] }), spent.get(name)!);

  let active = provider;
  let streak = 0;
  let fallbackLeft = 0;
  const failoverAfter = opts.failoverAfter ?? 3;

  for (const [i, pq] of plan.entries()) {
    if (active === provider && opts.fallback?.info.configured && streak >= failoverAfter) {
      fallbackLeft = await dailyFlightBudget(prisma, opts.fallback, settings, now, today);
      log(`Flights: ${providerName} failed ${streak} times in a row; switching to ${opts.fallback.info.name} (budget ${fallbackLeft})`);
      failures.push(`${providerName} kept failing; used ${opts.fallback.info.name} for the rest of this run`);
      active = opts.fallback;
    }
    // Fallback queries search all origins as one request when that's how the fallback counts.
    const query = active === provider ? pq.query : { ...pq.query, origins: active.info.costPerPair ? pq.query.origins : searchOrigins(settings) };
    if (active !== provider) {
      const c = costOf(active)(query);
      if (c > fallbackLeft) break;
      fallbackLeft -= c;
    }
    const acc = account(active.info.name);
    const res = await active.search(query);
    searched++;
    if (!res.ok) {
      const msg = `${query.destinations.join("/")} ${query.outboundDate}→${query.returnDate}: ${res.error}`;
      failures.push(msg);
      acc.failures.push(msg);
      if (active === provider) streak++;
      continue;
    }
    if (active === provider) streak = 0;
    if (!res.cached) acc.queries += costOf(active)(query);

    const best = cheapestWithPositioning(res.offers, (a) => positioningCostFor(settings, a));
    if (best) {
      await prisma.priceSnapshot.create({
        data: {
          lineItemId: pq.lineItemId,
          query: query as unknown as Prisma.InputJsonValue,
          variant: pq.variant,
          isBaseline: pq.isBaseline,
          provider: res.provider,
          price: best.price,
          positioningCost: best.positioningCost,
          totalPrice: best.total,
          currency: best.currency,
          origin: best.origin,
          destination: best.destination,
          outboundDate: new Date(`${query.outboundDate}T00:00:00Z`),
          returnDate: new Date(`${query.returnDate}T00:00:00Z`),
          cabin: query.cabin,
          stops: best.stops,
          carrier: best.carrier,
          insightLabel: best.insightLabel,
          bookingUrl: res.searchUrl ?? best.bookingUrl,
          fetchedAt: res.fetchedAt,
          raw: res.raw as Prisma.InputJsonValue,
        },
      });
      snapshots++;
      acc.results++;
      touched.add(pq.lineItemId);
    } else {
      failures.push(`${query.destinations.join("/")} ${query.outboundDate}: no offers returned`);
    }
    if (!res.cached && i < plan.length - 1 && opts.pauseMs) await sleep(opts.pauseMs);
  }

  for (const id of touched) await refreshLineItemQuote(prisma, id, now);

  if (!spent.size) account(providerName);
  for (const [name, a] of spent) {
    await prisma.providerRun.create({
      data: {
        provider: name,
        kind: "flight",
        ok: a.failures.length === 0 || a.results > 0,
        queries: a.queries,
        results: a.results,
        error: a.failures.length ? a.failures.slice(0, 10).join("\n") : null,
      },
    });
  }
  log(`Flights: ${snapshots} snapshots, ${failures.length} failures, spent ${[...spent].map(([n, a]) => `${a.queries} on ${n}`).join(", ")}`);
  return { ok: failures.length === 0, planned: plan.length, searched, snapshots, failures };
}

/**
 * Today's flight budget for a source. SerpApi: what's left of its monthly share, spread over the
 * rest of the month. Free source: a fixed number of requests per day (one per airport pair).
 */
export async function dailyFlightBudget(prisma: PrismaClient, provider: FlightProvider, settings: AppSettings, now: Date, today: string): Promise<number> {
  if (provider.info.costPerPair) return settings.freeFlightDailyRequests;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const used = await prisma.providerRun.aggregate({
    where: { provider: provider.info.name, startedAt: { gte: monthStart } },
    _sum: { queries: true },
  });
  return dailyBudget(Math.floor(settings.serpapiMonthlyQuota * settings.flightQuotaShare), used._sum.queries ?? 0, today);
}
