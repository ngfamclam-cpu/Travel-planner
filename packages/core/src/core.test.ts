import { describe, expect, it } from "vitest";
import {
  addDays,
  baselineWindow,
  cheapestWithPositioning,
  computeSurge,
  dailyBudget,
  dateVariants,
  diffDays,
  eventClashes,
  eventWindow,
  findClashes,
  isPeakWindow,
  isStale,
  nights,
  planFlightQueries,
  seasonalTraps,
  todayIn,
  tripTotals,
} from "./index";

describe("event windows (spec §3)", () => {
  it("arrives the day before and leaves the day after", () => {
    expect(eventWindow("2027-03-26", "2027-03-28")).toEqual({ arrive: "2027-03-25", depart: "2027-03-29" });
    expect(eventWindow("2026-12-30", "2026-12-31")).toEqual({ arrive: "2026-12-29", depart: "2027-01-01" });
  });

  it("counts nights", () => {
    expect(nights({ arrive: "2027-05-13", depart: "2027-05-17" })).toBe(4);
  });

  it("builds ±flex variants that never miss part of the event", () => {
    const ev = { start: "2027-05-14", end: "2027-05-16" };
    const vs = dateVariants(eventWindow(ev.start, ev.end), 2, ev);
    expect(vs[0].label).toBe("base");
    for (const v of vs) {
      expect(v.arrive <= ev.start).toBe(true);
      expect(v.depart >= ev.end).toBe(true);
    }
    // arrive shifts: -2,-1,0,+1 (on start day); depart: -1,0,+1,+2 → 16 combos
    expect(vs).toHaveLength(16);
    expect(vs.some((v) => v.label === "+1/-1")).toBe(true);
    expect(vs.some((v) => v.outShift === 2)).toBe(false);
  });

  it("without an event, variants go both ways", () => {
    const vs = dateVariants({ arrive: "2027-03-30", depart: "2027-04-11" }, 1);
    expect(vs).toHaveLength(9);
  });
});

describe("dates", () => {
  it("adds and diffs across year boundary", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(diffDays("2026-12-29", "2027-01-01")).toBe(3);
  });
  it("gets today in New York", () => {
    expect(todayIn("America/New_York", new Date("2026-10-23T02:00:00Z"))).toBe("2026-10-22");
  });
});

describe("seasonal traps", () => {
  it("flags Florida spring break for Ultra", () => {
    const traps = seasonalTraps({ start: "2027-03-25", end: "2027-03-29" }, { country: "US", city: "Miami", airports: ["MIA"] });
    expect(traps.map((t) => t.id)).toContain("spring-break-fl");
  });
  it("flags cherry blossom in Tokyo but not in Vegas", () => {
    const w = { start: "2027-03-30", end: "2027-04-11" };
    expect(seasonalTraps(w, { country: "JP" }).map((t) => t.id)).toContain("cherry-blossom");
    expect(seasonalTraps(w, { country: "US", city: "Las Vegas" })).toHaveLength(0);
  });
  it("flags NYE everywhere and Memorial Day 2027", () => {
    expect(isPeakWindow({ start: "2026-12-29", end: "2027-01-01" }, { country: "US" })).toBe(true);
    // Memorial Day 2027 is May 31
    expect(seasonalTraps({ start: "2027-05-29", end: "2027-06-01" }, { country: "US" }).map((t) => t.id)).toContain("memorial-day");
  });
  it("flags Songkran in Bangkok", () => {
    expect(seasonalTraps({ start: "2027-04-12", end: "2027-04-15" }, { country: "TH" }).map((t) => t.id)).toContain("songkran");
  });
  it("finds a non-peak baseline week", () => {
    const w = { arrive: "2026-12-29", depart: "2027-01-01" };
    const b = baselineWindow(w, (x) => isPeakWindow({ start: x.arrive, end: x.depart }, { country: "US" }));
    expect(b).toEqual({ arrive: "2027-01-19", depart: "2027-01-22" });
  });
});

describe("surge", () => {
  it("labels the ratio", () => {
    expect(computeSurge(504, 240)).toMatchObject({ ratio: 2.1, level: "surge", label: "2.1× normal" });
    expect(computeSurge(400, 380)?.level).toBe("normal");
    expect(computeSurge(400, null)).toBeNull();
  });
});

describe("clashes", () => {
  const ultra = { id: "u", name: "Ultra", status: "considering" as const, arrive: "2027-03-25", depart: "2027-03-29" };
  const tokyoB = { id: "b", name: "Tokyo B", status: "considering" as const, arrive: "2027-03-30", depart: "2027-04-11" };
  const tokyoA = { id: "a", name: "Tokyo A", status: "considering" as const, arrive: "2027-03-12", depart: "2027-03-25" };

  it("flags a tight turnaround and an overlap", () => {
    expect(findClashes(ultra, [tokyoB])[0]).toMatchObject({ kind: "tight", gap: 1 });
    expect(findClashes(ultra, [tokyoA])[0]).toMatchObject({ kind: "overlap" });
  });
  it("doesn't flag alternatives in the same compare slot", () => {
    const a = { ...tokyoA, slot: "Asia" };
    const b = { ...tokyoB, arrive: "2027-03-12", slot: "Asia" };
    expect(findClashes(a, [b])).toHaveLength(0);
    expect(findClashes(ultra, [b])).toHaveLength(1);
  });
  it("ignores finished trips", () => {
    expect(findClashes(ultra, [{ ...tokyoA, status: "done" }])).toHaveLength(0);
  });
  it("checks discovered events against planned trips only", () => {
    const edc = { id: "e", name: "EDC", status: "planned" as const, arrive: "2027-05-13", depart: "2027-05-17" };
    expect(eventClashes({ start: "2027-05-14", end: "2027-05-15" }, [edc, ultra]).map((t) => t.id)).toEqual(["e"]);
  });
});

describe("totals", () => {
  it("prefers booked > quoted > estimate and counts unpriced", () => {
    const t = tripTotals([
      { estAmount: 400, quotedAmount: 427, bookedAmount: null, qty: 1 },
      { estAmount: 350, quotedAmount: null, bookedAmount: null, qty: 4 },
      { estAmount: null, quotedAmount: null, bookedAmount: 215, qty: 1 },
      { estAmount: null, quotedAmount: null, bookedAmount: null, qty: 1 },
    ]);
    expect(t).toEqual({ total: 2042, booked: 215, quoted: 427, estimated: 1400, unpricedCount: 1 });
  });
});

describe("freshness", () => {
  it("is stale after 48h", () => {
    const now = new Date("2026-10-22T12:00:00Z");
    expect(isStale(new Date("2026-10-20T11:00:00Z"), now)).toBe(true);
    expect(isStale(new Date("2026-10-21T11:00:00Z"), now)).toBe(false);
    expect(isStale(null, now)).toBe(true);
  });
});

describe("flight planner", () => {
  const base = {
    flexDays: 2,
    isPeak: () => false,
    spec: { destinations: ["MIA", "FLL"] },
  };
  const opts = { today: "2026-10-22", budget: 3, defaultOrigins: ["BOS", "JFK"], now: new Date("2026-10-22T12:00:00Z") };

  it("runs every trip's base dates before any flex variant", () => {
    const plan = planFlightQueries(
      [
        { ...base, lineItemId: "ultra", window: { arrive: "2027-03-25", depart: "2027-03-29" }, event: { start: "2027-03-26", end: "2027-03-28" }, lastFetched: {} },
        { ...base, lineItemId: "edc", window: { arrive: "2027-05-13", depart: "2027-05-17" }, event: { start: "2027-05-14", end: "2027-05-16" }, lastFetched: {} },
      ],
      opts,
    );
    expect(plan).toHaveLength(3);
    expect(plan.slice(0, 2).every((p) => p.variant === "base")).toBe(true);
    expect(plan[0].query.origins).toEqual(["BOS", "JFK"]);
  });

  it("skips variants fetched in the last 20 hours and adds a baseline", () => {
    const plan = planFlightQueries(
      [{ ...base, lineItemId: "x", window: { arrive: "2027-03-25", depart: "2027-03-29" }, lastFetched: { base: new Date("2026-10-22T06:00:00Z") } }],
      { ...opts, budget: 50 },
    );
    expect(plan.some((p) => p.variant === "base")).toBe(false);
    expect(plan.filter((p) => p.isBaseline)).toHaveLength(1);
  });

  it("budgets the rest of the month evenly", () => {
    expect(dailyBudget(150, 0, "2026-10-22")).toBe(15); // 10 days left incl. today
    expect(dailyBudget(150, 150, "2026-10-22")).toBe(0);
  });

  it("adds positioning costs when picking the cheapest", () => {
    const best = cheapestWithPositioning(
      [
        { price: 380, origin: "JFK" },
        { price: 427, origin: "BOS" },
      ],
      (a) => (a === "JFK" ? 60 : 0),
    );
    expect(best).toMatchObject({ origin: "BOS", total: 427 });
  });
});
