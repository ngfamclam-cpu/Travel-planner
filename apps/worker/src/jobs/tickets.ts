// Ticket tracker: daily prices for every tracked event across platforms, plus ticket alerts.
import {
  latestPerPlatform,
  lowestTicket,
  TICKET_PLATFORMS,
  ticketAlerts,
  todayIn,
  toISODate,
  type TicketAlertCandidate,
  type TicketPlatformId,
  type TicketQuote,
} from "@rave-run/core";
import { ensureTicketWatches, recordTicketPrice, type PrismaClient } from "@rave-run/db";
import type { TicketChecker, TicketEventRef, TicketMatch } from "@rave-run/providers";
import { loadSettings } from "../settings";

export interface TicketJobOptions {
  now?: Date;
  /** Pause between page checks so no site gets more than one slow request at a time. */
  pauseMs?: number;
  /** One-time "find the event page" lookups via SerpApi allowed per run. */
  findBudget?: number;
  /** Finds event pages on platforms without an API (SerpApi Google search); null to skip. */
  findPage?: (e: TicketEventRef, domain: string) => Promise<TicketMatch | null>;
  log?: (msg: string) => void;
}

export interface TicketJobResult {
  events: number;
  checked: number;
  prices: number;
  alerts: number;
  failures: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runTicketJob(
  prisma: PrismaClient,
  checkers: Record<TicketPlatformId, TicketChecker>,
  opts: TicketJobOptions = {},
): Promise<TicketJobResult> {
  const log = opts.log ?? console.log;
  const now = opts.now ?? new Date();
  const today = todayIn("America/New_York", now);
  const settings = await loadSettings(prisma);
  const failures: string[] = [];

  // Tracked events: anything with an active trip, or with a target price set.
  const events = await prisma.event.findMany({
    where: {
      endDate: { gte: new Date(`${today}T00:00:00Z`) },
      OR: [{ trips: { some: { status: { in: ["considering", "planned", "booked"] } } } }, { ticketTarget: { not: null } }],
    },
    include: { trips: { select: { id: true, status: true } } },
  });

  let findBudget = opts.findBudget ?? 4;
  let checked = 0;
  let prices = 0;
  let alerts = 0;
  const perPlatform = new Map<string, { ok: number; fail: number; errors: string[] }>();
  const tally = (p: string, ok: boolean, err?: string) => {
    const t = perPlatform.get(p) ?? { ok: 0, fail: 0, errors: [] };
    if (ok) t.ok++;
    else {
      t.fail++;
      if (err) t.errors.push(err);
    }
    perPlatform.set(p, t);
  };

  for (const ev of events) {
    const ref: TicketEventRef = { name: ev.name, city: ev.city, start: toISODate(ev.startDate), end: toISODate(ev.endDate) };
    const watches = await ensureTicketWatches(prisma, ev.id);
    const before = await quotesFor(prisma, ev.id, now);
    const previousLowest = lowestTicket(before, now)?.allIn ?? null;
    const statusChanges: { platform: TicketPlatformId; from: string | null; to: string; url?: string | null }[] = [];

    for (const w of watches) {
      if (!w.enabled) continue;
      const platform = w.platform as TicketPlatformId;
      const meta = TICKET_PLATFORMS[platform];
      const checker = checkers[platform];
      if (!meta || !checker || meta.access === "manual") continue;
      if (!checker.configured) {
        await prisma.ticketWatch.update({ where: { id: w.id }, data: { status: "not_configured", lastError: `${checker.envKeys.join(", ")} not set` } });
        continue;
      }

      // 1. Find the event on this platform (once).
      let { url, externalId } = w;
      if (!url && !externalId && !w.findTried) {
        let match: TicketMatch | null = null;
        try {
          if (checker.find) match = await checker.find(ref);
          else if (opts.findPage && meta.domain && findBudget > 0) {
            findBudget--;
            match = await opts.findPage(ref, meta.domain);
          } else continue; // no way to look it up today
        } catch (e) {
          failures.push(`${ev.name} on ${meta.name}: lookup failed: ${(e as Error).message}`);
        }
        url = match?.url ?? null;
        externalId = match?.externalId ?? null;
        await prisma.ticketWatch.update({
          where: { id: w.id },
          data: { url, externalId, findTried: true, status: match ? "ok" : "not_listed", lastError: match ? null : "not found on this platform (paste the event link to track it)" },
        });
        if (!match) continue;
      }
      if (!url && !externalId) continue;

      // 2. Once a day per watch.
      if (w.lastCheckedAt && now.getTime() - w.lastCheckedAt.getTime() < 20 * 3_600_000) continue;
      const res = await checker.check({ url, externalId });
      checked++;
      const status = res.ok ? "ok" : res.blocked ? "blocked" : res.notConfigured ? "not_configured" : res.noPrice ? "no_price" : "error";
      const official = meta.kind === "official" ? (res.status ?? (res.ok ? "onsale" : null)) : null;
      if (official && official !== w.officialState) statusChanges.push({ platform, from: w.officialState, to: official, url: url ?? undefined });
      await prisma.ticketWatch.update({
        where: { id: w.id },
        data: { status, lastError: res.ok ? null : res.error, lastCheckedAt: now, ...(official ? { officialState: official } : {}) },
      });
      tally(platform, res.ok, res.ok ? undefined : `${ev.name}: ${res.error}`);
      if (res.ok) {
        await recordTicketPrice(
          prisma,
          w,
          { listed: res.listed, feesIncluded: res.feesIncluded, highestBid: res.highestBid, tierLabel: res.tierLabel, source: meta.access === "api" ? "api" : "page", url: res.url, observedAt: now, raw: res.raw },
          settings.ticketFeePct,
        );
        prices++;
      }
      if (meta.access === "page" && opts.pauseMs) await sleep(opts.pauseMs);
    }

    // 3. Alerts for this event.
    const current = [...latestPerPlatform(await quotesFor(prisma, ev.id, now)).values()];
    const candidates = ticketAlerts(
      {
        eventId: ev.id,
        eventName: ev.name,
        target: ev.ticketTarget == null ? null : Number(ev.ticketTarget),
        current,
        previousLowest,
        statusChanges,
        crowdvoltGap: settings.crowdvoltGapAlert,
      },
      now,
    );
    const tripId = ev.trips.find((t) => t.status !== "done")?.id ?? null;
    for (const c of candidates) if (await saveTicketAlert(prisma, c, ev.id, tripId)) alerts++;
  }

  for (const [platform, t] of perPlatform) {
    await prisma.providerRun.create({
      data: {
        provider: platform,
        kind: "ticket",
        ok: t.ok > 0 || t.fail === 0,
        queries: t.ok + t.fail,
        results: t.ok,
        error: t.errors.length ? t.errors.slice(0, 8).join("\n") : null,
      },
    });
  }
  log(`Tickets: ${events.length} events, ${checked} checks, ${prices} prices, ${alerts} alerts`);
  return { events: events.length, checked, prices, alerts, failures };
}

/** Recent quotes for an event (all platforms, last 7 days). */
export async function quotesFor(prisma: PrismaClient, eventId: string, now: Date): Promise<TicketQuote[]> {
  const rows = await prisma.ticketPrice.findMany({
    where: { eventId, observedAt: { gte: new Date(now.getTime() - 7 * 86_400_000), lte: now } },
    orderBy: { observedAt: "desc" },
  });
  return rows.map((r) => ({
    platform: r.platform as TicketPlatformId,
    allIn: Number(r.allInPrice),
    listed: Number(r.listedPrice),
    feesEstimated: r.feesEstimated,
    highestBid: r.highestBid == null ? null : Number(r.highestBid),
    tierLabel: r.tierLabel,
    observedAt: r.observedAt,
    url: r.url,
    source: r.source as TicketQuote["source"],
    risky: r.risky,
  }));
}

/**
 * One open alert per event and kind: a new one replaces it only when it's better
 * (lower price, bigger drop, smaller CrowdVolt gap). On-sale/sold-out changes always alert.
 */
async function saveTicketAlert(prisma: PrismaClient, c: TicketAlertCandidate, eventId: string, tripId: string | null): Promise<boolean> {
  if (await prisma.alert.findUnique({ where: { dedupeKey: c.dedupeKey } })) return false;
  const openSame = await prisma.alert.findMany({ where: { kind: c.kind, dismissedAt: null, dedupeKey: { startsWith: `${c.kind}:${eventId}:` } } });
  if (c.kind === "ticket_target" || c.kind === "ticket_drop" || c.kind === "crowdvolt_gap") {
    const better = (old: number) => (c.kind === "crowdvolt_gap" ? (c.amount ?? Infinity) < old : (c.amount ?? 0) > old);
    if (openSame.some((a) => !better(Number(a.amount ?? 0)))) return false;
  }
  if (openSame.length) await prisma.alert.updateMany({ where: { id: { in: openSame.map((a) => a.id) } }, data: { dismissedAt: new Date() } });
  await prisma.alert.create({
    data: { kind: c.kind, title: c.title, body: c.body, amount: c.amount ?? null, url: c.url ?? null, dedupeKey: c.dedupeKey, tripId },
  });
  return true;
}
