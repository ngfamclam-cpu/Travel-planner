// Explore Asia: nonstop fare calendars from Boston / New York to Tokyo, Seoul, Shanghai and Hong Kong.
// Prices come from Google Flights' price calendar, one request per route per 61-day chunk.
import { addDays, diffDays, type ISODate } from "./dates";
import { DEFAULT_SETTINGS, positioningCostFor, type AppSettings, type AsiaWatchSettings } from "./settings";

export const ASIA_CITIES = [
  { id: "TYO", name: "Tokyo", airports: ["HND", "NRT"], color: "#ef4444" },
  { id: "SEL", name: "Seoul", airports: ["ICN"], color: "#3b82f6" },
  { id: "SHA", name: "Shanghai", airports: ["PVG"], color: "#f59e0b" },
  { id: "HKG", name: "Hong Kong", airports: ["HKG"], color: "#a855f7" },
] as const;

export const ASIA_ORIGINS = [
  { id: "BOS", name: "Boston", airports: ["BOS"] },
  { id: "NYC", name: "New York", airports: ["JFK", "EWR"] },
] as const;

export type AsiaCityId = (typeof ASIA_CITIES)[number]["id"];
export type AsiaOriginId = (typeof ASIA_ORIGINS)[number]["id"];
/** round = there and back; out = one-way to Asia; back = one-way home. */
export type AsiaKind = "round" | "out" | "back";

export const CALENDAR_CHUNK_DAYS = 61;

export function asiaConfig(s: AppSettings): AsiaWatchSettings {
  const c = { ...DEFAULT_SETTINGS.asiaWatch, ...(s.asiaWatch ?? {}) };
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(n) || lo)));
  const minNights = clamp(c.minNights, 1, 30);
  return {
    enabled: c.enabled !== false,
    minNights,
    maxNights: clamp(Math.max(c.maxNights, minNights), minNights, Math.min(30, minNights + 9)),
    months: clamp(c.months, 1, 9),
    refreshDays: clamp(c.refreshDays, 1, 14),
    dailyRequests: clamp(c.dailyRequests, 0, 400),
  };
}

export const asiaCity = (id: string) => ASIA_CITIES.find((c) => c.id === id);
export const asiaOrigin = (id: string) => ASIA_ORIGINS.find((o) => o.id === id);

/** Getting to the origin from Boston, round trip (e.g. ~$60 to reach JFK/EWR); one-ways count half. */
export function asiaPositioning(settings: AppSettings, origin: AsiaOriginId, kind: AsiaKind): number {
  const o = asiaOrigin(origin)!;
  const full = Math.min(...o.airports.map((a) => positioningCostFor(settings, a)));
  return kind === "round" ? full : Math.round(full / 2);
}

export interface AsiaSeries {
  /** Stable id for this route × trip shape × 61-day slice. */
  key: string;
  kind: AsiaKind;
  origin: AsiaOriginId;
  city: AsiaCityId;
  nights: number; // 0 for one-ways
  from: ISODate;
  to: ISODate;
  /** What the sidecar is asked for (one-way home flips the airports). */
  request: { origins: string[]; destinations: string[]; from: ISODate; to: ISODate; trip: "round" | "one-way"; nights: number; nonstop: true };
}

/** Tracking window: tomorrow through `months` months out. */
export function asiaWindow(today: ISODate, months: number): { from: ISODate; to: ISODate } {
  return { from: addDays(today, 1), to: addDays(today, Math.round(months * 30.5)) };
}

/** Every calendar request needed to cover the window once. */
export function asiaSeries(settings: AppSettings, today: ISODate): AsiaSeries[] {
  const cfg = asiaConfig(settings);
  const win = asiaWindow(today, cfg.months);
  const chunks: { idx: number; from: ISODate; to: ISODate }[] = [];
  for (let from = win.from, idx = 0; from <= win.to; idx++) {
    const to = addDays(from, CALENDAR_CHUNK_DAYS - 1) < win.to ? addDays(from, CALENDAR_CHUNK_DAYS - 1) : win.to;
    chunks.push({ idx, from, to });
    from = addDays(to, 1);
  }
  const shapes: { kind: AsiaKind; nights: number }[] = [];
  for (let n = cfg.minNights; n <= cfg.maxNights; n++) shapes.push({ kind: "round", nights: n });
  shapes.push({ kind: "out", nights: 0 }, { kind: "back", nights: 0 });

  const out: AsiaSeries[] = [];
  for (const shape of shapes)
    for (const origin of ASIA_ORIGINS)
      for (const city of ASIA_CITIES)
        for (const ch of chunks) {
          const us = [...origin.airports];
          const asia = [...city.airports];
          out.push({
            key: `${shape.kind}:${origin.id}:${city.id}:${shape.nights}:${ch.idx}`,
            kind: shape.kind,
            origin: origin.id,
            city: city.id,
            nights: shape.nights,
            from: ch.from,
            to: ch.to,
            request: {
              origins: shape.kind === "back" ? asia : us,
              destinations: shape.kind === "back" ? us : asia,
              from: ch.from,
              to: ch.to,
              trip: shape.kind === "round" ? "round" : "one-way",
              nights: shape.nights,
              nonstop: true,
            },
          });
        }
  return out;
}

/**
 * Which series to fetch now: never-scanned first (so a new install fills quickly, up to `firstFillCap`),
 * then anything older than refreshDays, oldest first and nearer dates first. Capped at the daily budget.
 */
export function dueAsiaSeries(
  series: AsiaSeries[],
  lastScan: Map<string, Date>,
  opts: { now: Date; refreshDays: number; cap: number; firstFillCap?: number },
): AsiaSeries[] {
  // Allow a few hours of slack so a daily job doesn't slip a whole day.
  const staleMs = opts.refreshDays * 86_400_000 - 6 * 3_600_000;
  const never = series.filter((s) => !lastScan.has(s.key));
  const stale = series
    .filter((s) => lastScan.has(s.key) && opts.now.getTime() - lastScan.get(s.key)!.getTime() >= staleMs)
    .sort((a, b) => lastScan.get(a.key)!.getTime() - lastScan.get(b.key)!.getTime() || a.from.localeCompare(b.from));
  // Fill order for new series: nearest months first, round trips before one-ways.
  const rank = (s: AsiaSeries) => (s.kind === "round" ? 0 : 1);
  never.sort((a, b) => a.from.localeCompare(b.from) || rank(a) - rank(b));
  const firstFill = never.slice(0, Math.max(opts.cap, opts.firstFillCap ?? 0));
  return [...firstFill, ...stale].slice(0, Math.max(opts.cap, firstFill.length));
}

// ---------- calendar shaping ----------

export interface AsiaFareRow {
  kind: AsiaKind;
  origin: AsiaOriginId;
  city: AsiaCityId;
  date: ISODate;
  returnDate: ISODate | null;
  nights: number;
  price: number;
  prevPrice: number | null;
  lowPrice: number;
  fetchedAt: Date;
}

export interface AsiaOption {
  kind: AsiaKind | "two_oneways";
  origin: AsiaOriginId;
  /** For two one-ways, the airport group flown home to (can differ from origin). */
  homeTo?: AsiaOriginId;
  city: AsiaCityId;
  date: ISODate;
  returnDate: ISODate | null;
  nights: number;
  fare: number;
  /** Fare plus getting to NYC when flying from there. */
  allIn: number;
  prevPrice: number | null;
  lowPrice: number | null;
  fetchedAt: Date;
}

export interface AsiaFilter {
  mode: "round" | "out" | "back";
  city?: AsiaCityId | "all";
  origin?: AsiaOriginId | "any";
  nights?: number | "any";
}

/** All bookable options per date for the chosen mode, cheapest all-in first. */
export function asiaOptions(rows: AsiaFareRow[], settings: AppSettings, f: AsiaFilter): Map<ISODate, AsiaOption[]> {
  const okCity = (c: string) => !f.city || f.city === "all" || f.city === c;
  const okOrigin = (o: string) => !f.origin || f.origin === "any" || f.origin === o;
  const okNights = (n: number) => f.nights == null || f.nights === "any" || f.nights === n;
  const byDate = new Map<ISODate, AsiaOption[]>();
  const add = (o: AsiaOption) => byDate.set(o.date, [...(byDate.get(o.date) ?? []), o]);

  for (const r of rows) {
    if (r.kind !== f.mode || !okCity(r.city) || !okOrigin(r.origin) || (r.kind === "round" && !okNights(r.nights))) continue;
    add({
      kind: r.kind,
      origin: r.origin,
      city: r.city,
      date: r.date,
      returnDate: r.returnDate,
      nights: r.nights,
      fare: r.price,
      allIn: r.price + asiaPositioning(settings, r.origin, r.kind),
      prevPrice: r.prevPrice,
      lowPrice: r.lowPrice,
      fetchedAt: r.fetchedAt,
    });
  }

  if (f.mode === "round") {
    // Two one-ways (same city, either US airport group each way) when that beats the round trip.
    const cfg = asiaConfig(settings);
    const outs = rows.filter((r) => r.kind === "out" && okCity(r.city) && okOrigin(r.origin));
    const backs = new Map<string, AsiaFareRow[]>();
    for (const r of rows) {
      if (r.kind !== "back" || !okCity(r.city) || !okOrigin(r.origin)) continue;
      const k = `${r.city}:${r.date}`;
      backs.set(k, [...(backs.get(k) ?? []), r]);
    }
    for (const o of outs) {
      for (let n = cfg.minNights; n <= cfg.maxNights; n++) {
        if (!okNights(n)) continue;
        const ret = addDays(o.date, n);
        for (const b of backs.get(`${o.city}:${ret}`) ?? []) {
          add({
            kind: "two_oneways",
            origin: o.origin,
            homeTo: b.origin,
            city: o.city,
            date: o.date,
            returnDate: ret,
            nights: n,
            fare: o.price + b.price,
            allIn: o.price + b.price + asiaPositioning(settings, o.origin, "out") + asiaPositioning(settings, b.origin, "back"),
            prevPrice: null,
            lowPrice: null,
            fetchedAt: o.fetchedAt < b.fetchedAt ? o.fetchedAt : b.fetchedAt,
          });
        }
      }
    }
  }
  for (const [d, list] of byDate) {
    // Two one-ways only count when no round trip for the same city and stay is as cheap.
    const kept = list.filter(
      (o) => o.kind !== "two_oneways" || !list.some((r) => r.kind === "round" && r.city === o.city && r.nights === o.nights && r.allIn <= o.allIn),
    );
    byDate.set(d, kept.sort((a, b) => a.allIn - b.allIn || a.fare - b.fare));
  }
  return byDate;
}

export type PriceBand = "low" | "fair" | "high" | "peak";

/** Quartile bands over the shown calendar, so colours mean "cheap for this view". */
export function priceBands(values: number[]): (v: number) => PriceBand {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return () => "fair";
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  return (v) => (v <= q1 ? "low" : v <= q2 ? "fair" : v <= q3 ? "high" : "peak");
}

/** Cheapest all-in per city per month (YYYY-MM), for the "when to go" table. */
export function monthlyBest(best: Map<ISODate, AsiaOption[]>): Map<string, Map<string, AsiaOption>> {
  const out = new Map<string, Map<string, AsiaOption>>();
  for (const list of best.values()) {
    for (const o of list) {
      const m = o.date.slice(0, 7);
      const row = out.get(o.city) ?? new Map<string, AsiaOption>();
      const cur = row.get(m);
      if (!cur || o.allIn < cur.allIn) row.set(m, o);
      out.set(o.city, row);
    }
  }
  return out;
}

/** The n cheapest dates (one option per date), at least `gapDays` apart so it isn't one cheap week n times. */
export function cheapestDates(best: Map<ISODate, AsiaOption[]>, n = 5, gapDays = 4): AsiaOption[] {
  const firsts = [...best.values()].map((l) => l[0]!).sort((a, b) => a.allIn - b.allIn);
  const picked: AsiaOption[] = [];
  for (const o of firsts) {
    if (picked.length >= n) break;
    if (picked.every((p) => Math.abs(diffDays(p.date, o.date)) >= gapDays)) picked.push(o);
  }
  return picked;
}
