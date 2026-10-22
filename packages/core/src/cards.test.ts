import { describe, expect, it } from "vitest";
import { buildDateCards, cheapestTicket, priceCard, sortCards, type DateCardInput, type FlightSnap, type HotelSnap } from "./index";

const t = new Date("2026-10-22T10:00:00Z");
const fl = (arrive: string, depart: string, total: number, fetchedAt = t): FlightSnap => ({
  arrive, depart, total, positioningCost: 0, origin: "BOS", carrier: "AA", stops: 0, insight: null, url: null, fetchedAt,
});
const ht = (arrive: string, depart: string, tier: HotelSnap["tier"], total: number, name = "H"): HotelSnap => ({
  arrive, depart, tier, name, total, perNight: total / 4, stars: 4, rating5: 4.3, refundable: true, url: null, fetchedAt: t,
});

const input: DateCardInput = {
  anchor: { arrive: "2027-03-25", depart: "2027-03-29" },
  chosen: { arrive: "2027-03-25", depart: "2027-03-29" },
  flexDays: 1,
  event: { start: "2027-03-26", end: "2027-03-28" },
  today: "2026-10-22",
  now: new Date("2026-10-22T12:00:00Z"),
  needsFlight: true,
  needsHotel: true,
  hotelEstPerNight: 350,
  flights: [
    fl("2027-03-25", "2027-03-29", 450, new Date("2026-10-20T10:00:00Z")), // older search
    fl("2027-03-25", "2027-03-29", 427),
    fl("2027-03-25", "2027-03-30", 380),
    fl("2027-03-24", "2027-03-29", 410),
  ],
  hotels: [
    ht("2027-03-25", "2027-03-29", "cheapest", 1400),
    ht("2027-03-25", "2027-03-29", "rated", 2200, "Lux"),
    ht("2027-03-25", "2027-03-30", "cheapest", 1100),
    ht("2027-03-24", "2027-03-29", "cheapest", 1800),
  ],
  ticket: { label: "GA", price: 517, source: "Vivid", resale: true, others: [] },
  fixedCosts: 60,
};

describe("date cards", () => {
  const cards = buildDateCards(input);

  it("makes one card per date combination, chosen first", () => {
    // flex ±1: arrive Mar 24–26 × depart Mar 29–30
    expect(cards).toHaveLength(6);
    expect(cards.map((c) => `${c.arrive}→${c.depart}`).slice(0, 3)).toEqual([
      "2027-03-25→2027-03-29",
      "2027-03-24→2027-03-29",
      "2027-03-25→2027-03-30",
    ]);
    expect(cards[0]).toMatchObject({ isChosen: true, label: "base", nights: 4 });
    expect(cards[0].flight?.total).toBe(427); // latest search, not the older $450
  });

  it("prices flight + hotel tier + ticket + fixed", () => {
    expect(priceCard(cards[0], "cheapest")).toMatchObject({ total: 427 + 1400 + 517 + 60, complete: true, estimated: false });
    expect(priceCard(cards[0], "rated").total).toBe(427 + 2200 + 517 + 60);
  });

  it("falls back to the hotel estimate (flagged), but not for my hotel / rentals", () => {
    expect(priceCard(cards[0], "value")).toMatchObject({ estimated: true, total: 427 + 1400 + 517 + 60 });
    expect(priceCard(cards[0], "pinned")).toMatchObject({ complete: false, missing: ["my hotel"] });
  });

  it("sorts complete cards cheapest first; unpriced flights last", () => {
    const sorted = sortCards(cards, "cheapest");
    expect(sorted[0].card.arrive + "→" + sorted[0].card.depart).toBe("2027-03-25→2027-03-30"); // 380 + 1100
    expect(sorted.slice(0, 3).every((s) => s.price.complete)).toBe(true);
    expect(sorted.slice(3).every((s) => s.price.missing.includes("flight"))).toBe(true);
  });

  it("works for trips without flights (e.g. Amtrak to HiJinx)", () => {
    const c = buildDateCards({ ...input, needsFlight: false, flights: [] });
    expect(priceCard(c[0], "cheapest")).toMatchObject({ complete: true, total: 1400 + 517 + 60 });
  });
});

describe("cheapestTicket", () => {
  it("prefers face value on sale, then resale", () => {
    const t1 = cheapestTicket([
      { name: "GA", price: 215, onSale: true, soldOut: false, isResale: false, source: "official" },
      { name: "GA+", price: 285, onSale: true, soldOut: false, isResale: false, source: "official" },
      { name: "GA resale", price: 282, onSale: true, soldOut: false, isResale: true, source: "resale" },
    ]);
    expect(t1).toMatchObject({ label: "GA", price: 215, resale: false });
    expect(t1?.others.map((o) => o.label)).toEqual(["GA+", "GA resale"]);
    const t2 = cheapestTicket([
      { name: "GA", price: null, onSale: false, soldOut: true, isResale: false, source: "Front Gate" },
      { name: "GA resale", price: 517, onSale: true, soldOut: false, isResale: true, source: "Vivid" },
    ]);
    expect(t2).toMatchObject({ price: 517, resale: true });
    expect(cheapestTicket([])).toBeNull();
  });
});
