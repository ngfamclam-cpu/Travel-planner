import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  asiaConfig,
  asiaOptions,
  asiaSeries,
  cheapestDates,
  dueAsiaSeries,
  monthlyBest,
  priceBands,
  type AppSettings,
  type AsiaFareRow,
} from "./index";

const settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
const at = new Date("2026-10-23T12:00:00Z");

function fare(p: Partial<AsiaFareRow>): AsiaFareRow {
  return { kind: "round", origin: "BOS", city: "TYO", date: "2026-11-10", returnDate: "2026-11-17", nights: 7, price: 1000, prevPrice: null, lowPrice: 1000, fetchedAt: at, ...p };
}

describe("Explore Asia series", () => {
  it("covers 6 months in 61-day chunks for every route and trip shape", () => {
    const s = asiaSeries(settings, "2026-10-23");
    // 4 round-trip lengths + 2 one-way directions, 2 origins, 4 cities, 3 chunks
    expect(s).toHaveLength(6 * 2 * 4 * 3);
    expect(s[0]!.from).toBe("2026-10-24");
    expect(new Set(s.map((x) => x.key)).size).toBe(s.length);
    const back = s.find((x) => x.kind === "back" && x.origin === "NYC" && x.city === "TYO")!;
    expect(back.request).toMatchObject({ origins: ["HND", "NRT"], destinations: ["JFK", "EWR"], trip: "one-way", nonstop: true });
    const round = s.find((x) => x.kind === "round" && x.nights === 10)!;
    expect(round.request.trip).toBe("round");
    for (const x of s) expect((Date.parse(x.to) - Date.parse(x.from)) / 86_400_000).toBeLessThan(61);
  });

  it("refreshes stale series within the daily budget and fills new ones first", () => {
    const s = asiaSeries(settings, "2026-10-23");
    const first = dueAsiaSeries(s, new Map(), { now: at, refreshDays: 3, cap: 50, firstFillCap: 200 });
    expect(first).toHaveLength(s.length);
    expect(first[0]!.kind).toBe("round");

    const scans = new Map(s.map((x, i) => [x.key, new Date(at.getTime() - (i % 4) * 86_400_000)]));
    const due = dueAsiaSeries(s, scans, { now: at, refreshDays: 3, cap: 20 });
    expect(due).toHaveLength(20);
    for (const d of due) expect(at.getTime() - scans.get(d.key)!.getTime()).toBeGreaterThanOrEqual(3 * 86_400_000 - 6 * 3_600_000);
  });

  it("keeps settings in sane ranges", () => {
    expect(asiaConfig({ ...settings, asiaWatch: { ...settings.asiaWatch, minNights: 12, maxNights: 5, months: 40 } })).toMatchObject({ minNights: 12, maxNights: 12, months: 9 });
  });
});

describe("Explore Asia calendar", () => {
  it("adds the trip to New York and sorts by all-in price", () => {
    const rows = [fare({ origin: "BOS", price: 1100 }), fare({ origin: "NYC", price: 1060 })];
    const opts = asiaOptions(rows, settings, { mode: "round" }).get("2026-11-10")!;
    expect(opts.map((o) => [o.origin, o.allIn])).toEqual([["BOS", 1100], ["NYC", 1120]]);
  });

  it("offers two one-ways when they beat the round trip, matching the stay length", () => {
    const rows = [
      fare({ price: 1400 }),
      fare({ kind: "out", returnDate: null, nights: 0, price: 500 }),
      fare({ kind: "back", date: "2026-11-17", returnDate: null, nights: 0, price: 450, origin: "NYC" }),
      fare({ kind: "back", date: "2026-11-30", returnDate: null, nights: 0, price: 10 }), // 20 nights: outside 7–10
    ];
    const opts = asiaOptions(rows, settings, { mode: "round" }).get("2026-11-10")!;
    expect(opts[0]).toMatchObject({ kind: "two_oneways", origin: "BOS", homeTo: "NYC", returnDate: "2026-11-17", nights: 7, fare: 950, allIn: 980 });
    expect(opts).toHaveLength(2);

    // A cheaper round trip for the same stay hides the two one-ways.
    const cheaperRound = asiaOptions([...rows, fare({ price: 900, origin: "NYC" })], settings, { mode: "round" }).get("2026-11-10")!;
    expect(cheaperRound.some((o) => o.kind === "two_oneways")).toBe(false);
  });

  it("filters by city, origin and nights", () => {
    const rows = [fare({ city: "SEL" }), fare({ nights: 9, returnDate: "2026-11-19" }), fare({ origin: "NYC" })];
    expect([...asiaOptions(rows, settings, { mode: "round", city: "SEL" }).values()].flat()).toHaveLength(1);
    expect([...asiaOptions(rows, settings, { mode: "round", nights: 9 }).values()].flat()).toHaveLength(1);
    expect([...asiaOptions(rows, settings, { mode: "round", origin: "NYC" }).values()].flat()).toHaveLength(1);
    expect(asiaOptions(rows, settings, { mode: "out" }).size).toBe(0);
  });

  it("bands, monthly bests and spread-out cheapest dates", () => {
    const band = priceBands([100, 200, 300, 400, 500, 600, 700, 800]);
    expect([band(100), band(350), band(500), band(800)]).toEqual(["low", "fair", "high", "peak"]);

    const rows = [
      fare({ date: "2026-11-10", price: 900 }),
      fare({ date: "2026-11-11", price: 880 }),
      fare({ date: "2026-11-20", price: 950 }),
      fare({ date: "2026-12-05", price: 1200 }),
      fare({ date: "2026-12-06", city: "SEL", price: 700 }),
    ];
    const best = asiaOptions(rows, settings, { mode: "round" });
    const months = monthlyBest(best);
    expect(months.get("TYO")!.get("2026-11")!.fare).toBe(880);
    expect(months.get("SEL")!.get("2026-12")!.fare).toBe(700);
    expect(cheapestDates(best, 3).map((o) => o.date)).toEqual(["2026-12-06", "2026-11-11", "2026-11-20"]);
  });
});
