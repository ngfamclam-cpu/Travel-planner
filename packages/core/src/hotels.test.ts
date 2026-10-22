import { describe, expect, it } from "vitest";
import { defaultHotelLocation, eligibleHotels, planHotelQueries, rebookCandidate, type HotelOffer } from "./index";

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
  const base = { location: "hotels near Bayfront Park, Miami", window: { arrive: "2027-03-25", depart: "2027-03-29" }, isPeak: () => false };
  it("plans the stay plus a weekly baseline, and skips fresh items", () => {
    const now = new Date("2026-10-22T12:00:00Z");
    const plan = planHotelQueries([{ ...base, lineItemId: "a", lastFetched: {} }], { today: "2026-10-22", now, budget: 10, minStars: 3 });
    expect(plan.map((p) => p.variant)).toEqual(["base", "baseline"]);
    expect(plan[0].query).toMatchObject({ checkIn: "2027-03-25", checkOut: "2027-03-29", refundableOnly: true });
    expect(plan[1].query.checkIn).toBe("2027-04-15");
    const fresh = planHotelQueries(
      [{ ...base, lineItemId: "a", lastFetched: { base: new Date("2026-10-22T08:00:00Z"), baseline: new Date("2026-10-20T08:00:00Z") } }],
      { today: "2026-10-22", now, budget: 10, minStars: 3 },
    );
    expect(fresh).toHaveLength(0);
  });
  it("doesn't baseline booked stays (only watches them for rebooks)", () => {
    const plan = planHotelQueries([{ ...base, lineItemId: "a", lastFetched: {}, watchingBooked: true }], { today: "2026-10-22", budget: 10, minStars: 3 });
    expect(plan.map((p) => p.variant)).toEqual(["base"]);
  });
  it("builds a default location", () => {
    expect(defaultHotelLocation({ venue: "Bayfront Park", city: "Miami" })).toBe("hotels near Bayfront Park, Miami");
    expect(defaultHotelLocation({ venue: "TBA", city: "Brooklyn" })).toBe("hotels in Brooklyn");
    expect(defaultHotelLocation(null)).toBeNull();
  });
});
