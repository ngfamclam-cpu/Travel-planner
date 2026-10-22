import { describe, expect, it } from "vitest";
import { defaultHotelLocation, eligibleHotels, findPinnedHotel, hotelFetchKey, pickHotelTiers, planHotelQueries, rebookCandidate, type HotelOffer } from "./index";

const offer = (name: string, total: number, extra: Partial<HotelOffer> = {}): HotelOffer => ({
  provider: "t", name, total, pricePerNight: total / 4, currency: "USD", stars: 4, rating5: 4.3, refundable: true, ...extra,
});

describe("eligibleHotels", () => {
  it("applies stars, rating (/10 → /5) and refundable floors, cheapest first", () => {
    const out = eligibleHotels(
      [
        offer("Cheap 2-star", 300, { stars: 2 }),
        offer("Badly rated", 320, { rating5: 3.6 }),
        offer("Non-refundable", 340, { refundable: false }),
        offer("Good B", 900),
        offer("Good A", 800),
        offer("Unknown stars", 850, { stars: undefined }),
      ],
      { minStars: 3, minRating10: 8 },
    );
    expect(out.map((o) => o.name)).toEqual(["Good A", "Unknown stars", "Good B"]);
  });
});

describe("hotel tiers", () => {
  it("picks cheapest, best value (within 25%) and best rated", () => {
    const t = pickHotelTiers([
      offer("Cheap", 1000, { rating5: 4.0 }),
      offer("Value", 1200, { rating5: 4.5 }),
      offer("Pricey value", 1300, { rating5: 4.6 }),
      offer("Luxury", 2400, { rating5: 4.8 }),
    ]);
    expect(t.cheapest?.name).toBe("Cheap");
    expect(t.value?.name).toBe("Value"); // 1300 is over 1.25 × 1000
    expect(t.rated?.name).toBe("Luxury");
    expect(pickHotelTiers([])).toEqual({});
  });
  it("finds a pinned hotel by name", () => {
    const offers = [offer("The Elser Hotel & Residences", 1500), offer("EAST Miami", 1700)];
    expect(findPinnedHotel(offers, "east miami")?.name).toBe("EAST Miami");
    expect(findPinnedHotel(offers, "Elser Hotel")?.name).toBe("The Elser Hotel & Residences");
    expect(findPinnedHotel(offers, "Four Seasons")).toBeNull();
  });
});

describe("rebookCandidate", () => {
  const booking = { hotelName: "Hotel X", stars: 4, rating5: 4.2, refundable: true, cancelBy: "2027-03-20" };
  const opts = { today: "2026-11-01" };

  it("alerts on a cheaper same-or-better hotel", () => {
    const c = rebookCandidate(booking, 1400, [offer("Hotel Y", 1300, { stars: 4, rating5: 4.4 })], opts);
    expect(c).toMatchObject({ savings: 100, sameHotel: false });
  });
  it("alerts when the same hotel drops", () => {
    expect(rebookCandidate(booking, 1400, [offer("hotel x", 1250, { stars: 3, rating5: 4.0 })], opts)).toMatchObject({ sameHotel: true, savings: 150 });
  });
  it("ignores worse hotels, tiny savings, non-refundable bookings and passed deadlines", () => {
    expect(rebookCandidate(booking, 1400, [offer("Worse", 900, { stars: 3 })], opts)).toBeNull();
    expect(rebookCandidate(booking, 1400, [offer("Hotel Y", 1360)], opts)).toBeNull(); // < 5%
    expect(rebookCandidate({ ...booking, refundable: false }, 1400, [offer("Hotel Y", 1000)], opts)).toBeNull();
    expect(rebookCandidate(booking, 1400, [offer("Hotel Y", 1000)], { today: "2027-03-21" })).toBeNull();
  });
});

describe("hotel planner", () => {
  const w = { arrive: "2027-03-25", depart: "2027-03-29" };
  const base = {
    location: "hotels near Bayfront Park, Miami",
    city: "Miami",
    anchor: w,
    chosen: w,
    flexDays: 1,
    event: { start: "2027-03-26", end: "2027-03-28" },
    isPeak: () => false,
  };
  const now = new Date("2026-10-22T12:00:00Z");

  it("plans every date card's nights, chosen dates first, plus a weekly baseline", () => {
    const plan = planHotelQueries([{ ...base, lineItemId: "a", lastFetched: {} }], { today: "2026-10-22", now, budget: 50, minStars: 3 });
    // flex ±1: arrive Mar 24–26 × depart Mar 29–30 → 6 windows, plus baseline
    expect(plan.filter((p) => !p.isBaseline)).toHaveLength(6);
    expect(plan[0]).toMatchObject({ variant: "base", search: "list" });
    expect(plan[0].query).toMatchObject({ checkIn: "2027-03-25", checkOut: "2027-03-29", refundableOnly: true, lodging: "hotels" });
    expect(plan.find((p) => p.isBaseline)?.query.checkIn).toBe("2027-04-15");
  });

  it("adds pinned-hotel and rental searches, and skips fresh ones", () => {
    const plan = planHotelQueries(
      [{ ...base, lineItemId: "a", pinnedName: "Hotel X", includeRentals: true, lastFetched: { [hotelFetchKey("2027-03-25", "2027-03-29", "list")]: new Date("2026-10-22T08:00:00Z") } }],
      { today: "2026-10-22", now, budget: 50, minStars: 3 },
    );
    const baseRuns = plan.filter((p) => p.variant === "base");
    expect(baseRuns.map((p) => p.search).sort()).toEqual(["pinned", "rental"]);
    expect(baseRuns.find((p) => p.search === "pinned")?.query.location).toBe("Hotel X, Miami");
    expect(baseRuns.find((p) => p.search === "rental")?.query.lodging).toBe("rentals");
  });

  it("only watches the booked nights for booked stays", () => {
    const plan = planHotelQueries([{ ...base, lineItemId: "a", lastFetched: {}, watchingBooked: true, includeRentals: true }], { today: "2026-10-22", now, budget: 50, minStars: 3 });
    expect(plan.map((p) => `${p.variant}:${p.search}`)).toEqual(["base:list"]);
  });

  it("builds a default location", () => {
    expect(defaultHotelLocation({ venue: "Bayfront Park", city: "Miami" })).toBe("hotels near Bayfront Park, Miami");
    expect(defaultHotelLocation({ venue: "TBA", city: "Brooklyn" })).toBe("hotels in Brooklyn");
    expect(defaultHotelLocation(null)).toBeNull();
  });
});
