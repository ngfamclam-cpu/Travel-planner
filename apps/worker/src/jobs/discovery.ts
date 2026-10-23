// Step 5: weekly event discovery. New US EDM festivals from Edmtrain and Ticketmaster are merged into
// the events table (never duplicated); known events get missing details filled in.
import {
  addDays,
  findExisting,
  mergeFestivalDays,
  todayIn,
  toISODate,
  type DiscoveredEvent,
  type KnownEvent,
} from "@rave-run/core";
import { day, type Prisma, type PrismaClient } from "@rave-run/db";

export interface DiscoverySource {
  name: "edmtrain" | "ticketmaster";
  configured: boolean;
  envKey: string;
  fetch(range: { from: string; to: string }): Promise<DiscoveredEvent[]>;
}

export interface DiscoveryResult {
  found: number;
  created: number;
  updated: number;
  failures: string[];
}

const ASIA = new Set(["JP", "CN", "KR", "TW", "TH", "HK", "SG", "VN", "PH", "ID", "MY", "Japan", "China", "South Korea", "Taiwan", "Thailand"]);

export async function runDiscovery(
  prisma: PrismaClient,
  sources: DiscoverySource[],
  opts: { now?: Date; monthsAhead?: number; log?: (m: string) => void } = {},
): Promise<DiscoveryResult> {
  const log = opts.log ?? console.log;
  const today = todayIn("America/New_York", opts.now);
  const range = { from: today, to: addDays(today, Math.round((opts.monthsAhead ?? 12) * 30.5)) };
  const failures: string[] = [];
  const found: DiscoveredEvent[] = [];

  for (const src of sources) {
    if (!src.configured) {
      await prisma.providerRun.create({ data: { provider: src.name, kind: "event", ok: false, error: `${src.envKey} not set` } });
      continue;
    }
    try {
      const items = mergeFestivalDays(await src.fetch(range));
      found.push(...items);
      await prisma.providerRun.create({ data: { provider: src.name, kind: "event", ok: true, queries: 1, results: items.length } });
    } catch (e) {
      const msg = `${src.name}: ${(e as Error).message}`;
      failures.push(msg);
      await prisma.providerRun.create({ data: { provider: src.name, kind: "event", ok: false, queries: 1, error: msg } });
    }
  }

  const rows = await prisma.event.findMany({ where: { endDate: { gte: day(addDays(today, -7)) } } });
  const known: (KnownEvent & { row: (typeof rows)[number] })[] = rows.map((r) => ({ id: r.id, name: r.name, city: r.city, start: toISODate(r.startDate), row: r }));
  let created = 0;
  let updated = 0;

  for (const e of found) {
    const match = findExisting(e, known) as (KnownEvent & { row: (typeof rows)[number] }) | null;
    if (match) {
      const r = match.row;
      const ids = { ...((r.externalIds as Record<string, string> | null) ?? {}), [e.source]: e.externalId };
      const data: Prisma.EventUpdateInput = { externalIds: ids };
      if (!r.lineupHighlights.length && e.artists.length) data.lineupHighlights = e.artists.slice(0, 10);
      if ((!r.venue || r.venue === "TBA") && e.venue) data.venue = e.venue;
      if (r.lat == null && e.lat != null) Object.assign(data, { lat: e.lat, lng: e.lng });
      if (e.source === "edmtrain" && e.url) data.edmtrainUrl = e.url;
      if (e.source === "ticketmaster" && e.url && !r.ticketUrl) data.ticketUrl = e.url;
      // Approximate seed dates get corrected; confirmed dates (and trips built on them) are left alone.
      if (r.datesTentative) Object.assign(data, { startDate: day(e.start), endDate: day(e.end), datesTentative: false });
      await prisma.event.update({ where: { id: r.id }, data });
      updated++;
    } else {
      const ev = await prisma.event.create({
        data: {
          name: e.name,
          city: e.city || "TBA",
          country: e.country,
          region: ASIA.has(e.country) ? "Asia" : "US",
          venue: e.venue,
          lat: e.lat,
          lng: e.lng,
          startDate: day(e.start),
          endDate: day(e.end),
          genres: [],
          lineupHighlights: e.artists.slice(0, 10),
          airports: [],
          edmtrainUrl: e.source === "edmtrain" ? e.url : null,
          ticketUrl: e.source === "ticketmaster" ? e.url : null,
          externalIds: { [e.source]: e.externalId },
          source: e.source,
          status: "announced",
        },
      });
      known.push({ id: ev.id, name: ev.name, city: ev.city, start: e.start, row: ev });
      created++;
    }
  }
  log(`Discovery: ${found.length} found, ${created} new, ${updated} updated${failures.length ? `, ${failures.length} failed` : ""}`);
  return { found: found.length, created, updated, failures };
}
