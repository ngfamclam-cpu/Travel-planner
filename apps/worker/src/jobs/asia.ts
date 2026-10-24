// Explore Asia: keep a 6-month nonstop fare calendar for BOS/NYC ⇄ Tokyo, Seoul, Shanghai, Hong Kong.
// Each calendar request covers one route × trip shape × 61 days; every slice is re-checked every few days.
import { asiaConfig, asiaSeries, dueAsiaSeries, mergeSettings, todayIn, type AsiaSeries } from "@rave-run/core";
import { day, type PrismaClient } from "@rave-run/db";
import type { CalendarResult } from "@rave-run/providers";

export interface AsiaDeps {
  calendar: (req: AsiaSeries["request"]) => Promise<CalendarResult>;
}

const STOP_AFTER_FAILURES = 3;

export async function runAsia(prisma: PrismaClient, deps: AsiaDeps, opts: { now?: Date; log?: (m: string) => void } = {}) {
  const now = opts.now ?? new Date();
  const log = opts.log ?? console.log;
  const settings = mergeSettings(await prisma.setting.findMany());
  const cfg = asiaConfig(settings);
  if (!cfg.enabled) return { scanned: 0, skipped: "Explore Asia is off in Settings" };
  const today = todayIn("America/New_York", now);

  await prisma.asiaFare.deleteMany({ where: { date: { lt: day(today) } } });

  const series = asiaSeries(settings, today);
  const scans = await prisma.asiaScan.findMany();
  const usedToday = scans.filter((s) => now.getTime() - s.fetchedAt.getTime() < 24 * 3_600_000).length;
  // With no fares stored at all, earlier "empty" answers can't be trusted (e.g. an unreadable response): start over.
  const haveFares = (await prisma.asiaFare.count()) > 0;
  const lastScan = new Map(scans.filter((s) => s.ok && haveFares).map((s) => [s.key, s.fetchedAt]));
  const due = dueAsiaSeries(series, lastScan, { now, refreshDays: cfg.refreshDays, cap: Math.max(0, cfg.dailyRequests - usedToday), firstFillCap: 200 });

  let scanned = 0;
  let found = 0;
  let failures = 0;
  let lastError: string | undefined;
  for (const s of due) {
    const res = await deps.calendar(s.request);
    scanned++;
    if (!res.ok) {
      lastError = `${s.key}: ${res.kind}: ${res.error}`;
      log(`Explore Asia: ${lastError}`);
      await prisma.asiaScan.upsert({ where: { key: s.key }, create: { key: s.key, fetchedAt: now, ok: false, error: res.error.slice(0, 500) }, update: { fetchedAt: now, ok: false, error: res.error.slice(0, 500) } });
      if (res.kind === "bad_request") continue;
      if (++failures >= STOP_AFTER_FAILURES || res.kind === "not_configured") break;
      continue;
    }
    failures = 0;
    found += await saveSeries(prisma, s, res.prices, now);
  }

  // Every route empty (Tokyo and Seoul have daily nonstops) means the answers were unusable, not "no flights".
  const allEmpty = scanned >= 4 && found === 0 && !haveFares;
  if (allEmpty) lastError = `Google answered ${scanned} calendar requests with no fares at all; the free source is probably blocked or changed. ${lastError ?? ""}`.trim();
  await prisma.providerRun.create({
    data: { provider: "google_flights_calendar", kind: "asia", ok: !allEmpty && (scanned === 0 || failures < STOP_AFTER_FAILURES), queries: scanned, results: found, error: lastError?.slice(0, 1000) },
  });
  log(`Explore Asia: ${scanned} calendar requests, ${found} fares (${due.length} due of ${series.length}).`);
  return { scanned, found, due: due.length, total: series.length };
}

/** Upserts one slice's fares in one statement (keeping previous/lowest/highest) and drops dates that no longer have a nonstop. */
async function saveSeries(prisma: PrismaClient, s: AsiaSeries, prices: { date: string; return?: string; price: number }[], now: Date): Promise<number> {
  const rows = new Map<string, { ret: string | null; price: number }>();
  for (const p of prices) {
    if (p.date < s.from || p.date > s.to || rows.has(p.date)) continue;
    rows.set(p.date, { ret: s.kind === "round" && p.return ? p.return : null, price: p.price });
  }
  const dates = [...rows.keys()];
  const rets = dates.map((d) => rows.get(d)!.ret);
  const amounts = dates.map((d) => rows.get(d)!.price);
  await prisma.$transaction([
    prisma.$executeRaw`
      INSERT INTO asia_fares (id, kind, origin, city, nights, date, return_date, price, low_price, high_price, first_seen_at, fetched_at)
      SELECT gen_random_uuid()::text, ${s.kind}, ${s.origin}, ${s.city}, ${s.nights}, t.d, t.r, t.p, t.p, t.p, ${now}, ${now}
      FROM unnest(${dates}::text[]::date[], ${rets}::text[]::date[], ${amounts}::text[]::numeric[]) AS t(d, r, p)
      ON CONFLICT (kind, origin, city, date, nights) DO UPDATE SET
        prev_price = CASE WHEN asia_fares.price <> EXCLUDED.price THEN asia_fares.price ELSE asia_fares.prev_price END,
        price = EXCLUDED.price,
        return_date = EXCLUDED.return_date,
        low_price = LEAST(asia_fares.low_price, EXCLUDED.price),
        high_price = GREATEST(asia_fares.high_price, EXCLUDED.price),
        fetched_at = EXCLUDED.fetched_at`,
    prisma.$executeRaw`
      DELETE FROM asia_fares
      WHERE kind = ${s.kind} AND origin = ${s.origin} AND city = ${s.city} AND nights = ${s.nights}
        AND date BETWEEN ${s.from}::date AND ${s.to}::date AND NOT (date = ANY(${dates}::text[]::date[]))`,
    prisma.asiaScan.upsert({ where: { key: s.key }, create: { key: s.key, fetchedAt: now, ok: true, found: rows.size }, update: { fetchedAt: now, ok: true, found: rows.size, error: null } }),
  ]);
  return rows.size;
}
