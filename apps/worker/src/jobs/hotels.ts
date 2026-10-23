// Step 4: hotels for the exact trip nights, surge baseline, and rebook alerts (spec §3, §7).
import {
  dailyBudget,
  defaultHotelLocation,
  destinationFromAirports,
  eligibleHotels,
  findPinnedHotel,
  hotelFetchKey,
  isPeakWindow,
  pickHotelTiers,
  planHotelQueries,
  rebookCandidate,
  todayIn,
  toISODate,
  type Destination,
  type FlightSearchSpec,
  type HotelBooking,
  type HotelOffer,
  type HotelPlannerItem,
  type HotelSearchSpec,
  type HotelTier,
} from "@rave-run/core";
import type { Prisma, PrismaClient } from "@rave-run/db";
import type { HotelProvider } from "@rave-run/providers";
import { loadSettings } from "../settings";
import { refreshLineItemQuote, type ChosenOption } from "@rave-run/db";

export interface HotelJobOptions {
  now?: Date;
  pauseMs?: number;
  budget?: number;
  log?: (msg: string) => void;
}

export interface HotelJobResult {
  ok: boolean;
  planned: number;
  snapshots: number;
  alerts: number;
  failures: string[];
  skippedReason?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

export async function runHotelJob(prisma: PrismaClient, provider: HotelProvider, opts: HotelJobOptions = {}): Promise<HotelJobResult> {
  const log = opts.log ?? console.log;
  const now = opts.now ?? new Date();
  const today = todayIn("America/New_York", now);
  const settings = await loadSettings(prisma);
  const name = provider.info.name;

  if (!provider.info.configured) {
    const error = `${provider.info.envKeys.join(", ")} not set`;
    await prisma.providerRun.create({ data: { provider: name, kind: "hotel", ok: false, error } });
    log(`Hotels: ${error}`);
    return { ok: false, planned: 0, snapshots: 0, alerts: 0, failures: [error], skippedReason: error };
  }

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const used = await prisma.providerRun.aggregate({ where: { provider: name, startedAt: { gte: monthStart } }, _sum: { queries: true } });
  const allowance = Math.floor(settings.serpapiMonthlyQuota * (1 - settings.flightQuotaShare));
  const budget = opts.budget ?? dailyBudget(allowance, used._sum.queries ?? 0, today);

  const items = await prisma.lineItem.findMany({
    where: {
      kind: "hotel",
      included: true, // switched-off hotels aren't searched
      trip: { status: { in: ["considering", "planned", "booked"] }, arriveDate: { gte: day(today) } },
    },
    include: { trip: { include: { event: true, lineItems: { where: { kind: "flight" } } } } },
  });

  const failures: string[] = [];
  const plannerItems: HotelPlannerItem[] = [];
  for (const li of items) {
    const booked = li.bookedAmount != null;
    const booking = (li.booking ?? {}) as HotelBooking;
    // A booked non-refundable stay can't be improved; skip it.
    if (booked && !booking.refundable) continue;
    const spec = (li.searchSpec ?? {}) as HotelSearchSpec;
    const location = spec.query?.trim() || defaultHotelLocation(li.trip.event);
    if (!location) {
      failures.push(`${li.trip.name}: set a hotel search area on the hotel line item`);
      continue;
    }
    const airports = li.trip.lineItems.flatMap((f) => (f.searchSpec as FlightSearchSpec | null)?.destinations ?? []);
    const ev = li.trip.event;
    const dest: Destination = ev ? { country: ev.country, city: ev.city, airports } : destinationFromAirports(airports);
    const snaps = await prisma.priceSnapshot.findMany({
      where: { lineItemId: li.id },
      select: { outboundDate: true, returnDate: true, isBaseline: true, tier: true, fetchedAt: true },
      orderBy: { fetchedAt: "desc" },
      take: 400,
    });
    const lastFetched: Record<string, Date | undefined> = {};
    for (const s of snaps) {
      const key = s.isBaseline
        ? "baseline"
        : hotelFetchKey(toISODate(s.outboundDate!), toISODate(s.returnDate!), s.tier === "pinned" ? "pinned" : s.tier === "rental" ? "rental" : "list");
      lastFetched[key] ??= s.fetchedAt;
    }
    const chosen = { arrive: toISODate(li.trip.arriveDate), depart: toISODate(li.trip.departDate) };
    const anchor = ((li.trip.chosenOption ?? {}) as ChosenOption).anchor ?? chosen;
    const evStart = ev ? toISODate(ev.startDate) : undefined;
    const evEnd = ev ? toISODate(ev.endDate) : undefined;
    plannerItems.push({
      lineItemId: li.id,
      location,
      city: ev?.city,
      pinnedName: spec.pinned?.name,
      includeRentals: spec.includeRentals,
      anchor,
      chosen,
      flexDays: li.trip.flexDays,
      event: evStart && evEnd && anchor.arrive <= evStart && anchor.depart >= evEnd ? { start: evStart, end: evEnd } : undefined,
      lastFetched,
      isPeak: (w) => isPeakWindow({ start: w.arrive, end: w.depart }, dest),
      watchingBooked: booked,
    });
  }

  const plan = planHotelQueries(plannerItems, { today, now, budget, minStars: settings.hotelMinStars });
  log(`Hotels: ${plannerItems.length} items, budget ${budget}, running ${plan.length} searches`);

  let snapshots = 0;
  let quotaSpent = 0;
  const touched = new Set<string>();
  const offersByItem = new Map<string, HotelOffer[]>();

  for (const [i, pq] of plan.entries()) {
    const res = await provider.search(pq.query);
    if (!res.ok) {
      failures.push(`${pq.query.location} ${pq.query.checkIn}→${pq.query.checkOut}: ${res.error}`);
      continue;
    }
    if (!res.cached) quotaSpent++;
    const floors = { minStars: pq.search === "list" ? settings.hotelMinStars : 0, minRating10: settings.hotelMinRating10 };
    const good = eligibleHotels(res.offers, floors);

    // What to store for this search: the three list tiers, the pinned hotel, or the cheapest rental.
    const picks: [HotelTier | null, HotelOffer][] = [];
    if (pq.isBaseline) {
      if (good[0]) picks.push([null, good[0]]);
    } else if (pq.search === "list") {
      const tiers = pickHotelTiers(good);
      for (const t of ["cheapest", "value", "rated"] as const) if (tiers[t]) picks.push([t, tiers[t]!]);
    } else if (pq.search === "pinned") {
      const name = plannerItems.find((p) => p.lineItemId === pq.lineItemId)?.pinnedName ?? "";
      const hit = findPinnedHotel(res.offers.filter((o) => o.refundable !== false), name);
      if (hit) picks.push(["pinned", hit]);
    } else if (good[0]) {
      picks.push(["rental", good[0]]);
    }
    if (!picks.length) {
      const what = pq.search === "pinned" ? "your hotel had no free-cancellation rate" : pq.search === "rental" ? "no rentals met the rating floor" : `no refundable ${settings.hotelMinStars}★+ hotels rated ${settings.hotelMinRating10 / 2}+/5`;
      failures.push(`${pq.query.location} ${pq.query.checkIn}→${pq.query.checkOut}: ${what}`);
      continue;
    }

    const li = items.find((i) => i.id === pq.lineItemId);
    const isTripNights = li && pq.query.checkIn === toISODate(li.trip.arriveDate) && pq.query.checkOut === toISODate(li.trip.departDate);
    if (!pq.isBaseline && pq.search === "list" && isTripNights) offersByItem.set(pq.lineItemId, good);

    for (const [rank, [tier, o]] of picks.entries()) {
      await prisma.priceSnapshot.create({
        data: {
          lineItemId: pq.lineItemId,
          query: pq.query as unknown as Prisma.InputJsonValue,
          variant: pq.variant,
          isBaseline: pq.isBaseline,
          provider: res.provider,
          price: o.pricePerNight,
          totalPrice: o.total,
          currency: o.currency,
          outboundDate: day(pq.query.checkIn),
          returnDate: day(pq.query.checkOut),
          hotelName: o.name,
          stars: o.stars,
          rating: o.rating5,
          refundable: o.refundable,
          rank,
          tier,
          bookingUrl: o.bookingUrl ?? res.searchUrl,
          fetchedAt: res.fetchedAt,
          // Full payload on the first row only, to keep rows small.
          raw: (rank === 0 ? res.raw : o.raw) as Prisma.InputJsonValue,
        },
      });
      snapshots++;
    }
    touched.add(pq.lineItemId);
    if (!res.cached && i < plan.length - 1 && opts.pauseMs) await sleep(opts.pauseMs);
  }

  for (const id of touched) await refreshLineItemQuote(prisma, id, now);
  const alerts = await checkRebooks(prisma, offersByItem, today);

  await prisma.providerRun.create({
    data: {
      provider: name,
      kind: "hotel",
      ok: failures.length === 0 || snapshots > 0,
      queries: quotaSpent,
      results: snapshots,
      error: failures.length ? failures.slice(0, 10).join("\n") : null,
    },
  });
  log(`Hotels: ${snapshots} snapshots, ${alerts} rebook alerts, ${failures.length} failures, ${quotaSpent} searches spent`);
  return { ok: failures.length === 0, planned: plan.length, snapshots, alerts, failures };
}

/** Rebook alerts for booked refundable stays: a same-or-better hotel is now cheaper. */
export async function checkRebooks(prisma: PrismaClient, offersByItem: Map<string, HotelOffer[]>, today: string): Promise<number> {
  let created = 0;
  for (const [lineItemId, offers] of offersByItem) {
    const li = await prisma.lineItem.findUniqueOrThrow({ where: { id: lineItemId }, include: { trip: true } });
    if (li.bookedAmount == null) continue;
    const booking = (li.booking ?? {}) as HotelBooking;
    const bookedTotal = Number(li.bookedAmount) * li.qty;
    const cand = rebookCandidate(booking, bookedTotal, offers, { today });
    if (!cand) continue;
    const o = cand.offer;
    const key = `rebook:${lineItemId}:${o.name.toLowerCase()}:${Math.round(o.total)}`;
    const exists = await prisma.alert.findUnique({ where: { dedupeKey: key } });
    if (exists) continue;
    // One open rebook alert per stay: only replace it when the new rate saves more.
    const open = await prisma.alert.findMany({ where: { lineItemId, kind: "rebook", dismissedAt: null } });
    if (open.some((a) => Number(a.amount ?? 0) >= cand.savings)) continue;
    if (open.length) {
      await prisma.alert.updateMany({ where: { id: { in: open.map((a) => a.id) } }, data: { dismissedAt: new Date() } });
    }
    const quality = [o.stars ? `${o.stars}★` : null, o.rating5 ? `${o.rating5}/5` : null].filter(Boolean).join(", ");
    await prisma.alert.create({
      data: {
        lineItemId,
        tripId: li.tripId,
        kind: "rebook",
        title: `${li.trip.name}: rebook and save $${Math.round(cand.savings)}`,
        body:
          `${cand.sameHotel ? "Your hotel" : o.name}${quality ? ` (${quality})` : ""} has a free-cancellation rate of $${o.total} ` +
          `for your nights vs $${bookedTotal} booked. Book the new rate first, then cancel the old one` +
          (booking.cancelBy ? ` before ${booking.cancelBy}.` : "."),
        amount: cand.savings,
        url: o.bookingUrl,
        dedupeKey: key,
      },
    });
    created++;
  }
  return created;
}


