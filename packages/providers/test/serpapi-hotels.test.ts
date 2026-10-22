import { describe, expect, it, vi } from "vitest";
import type { HotelQuery } from "@rave-run/core";
import { hotelProvider, parseSerpHotels, SerpApiHotelProvider, serpHotelParams } from "../src";
import fixture from "./serpapi-hotels.fixture.json";

const q: HotelQuery = {
  location: "hotels near Bayfront Park, Miami",
  checkIn: "2027-03-25",
  checkOut: "2027-03-29",
  adults: 1,
  minStars: 3,
  refundableOnly: true,
  currency: "USD",
};

describe("SerpApi Google Hotels", () => {
  it("parses hotels, skips rentals and unpriced, handles string prices", () => {
    const offers = parseSerpHotels(fixture, q);
    expect(offers.map((o) => o.name)).toEqual(["Brickell Test Hotel", "String Price Inn"]);
    expect(offers[0]).toMatchObject({ total: 1556, pricePerNight: 389, stars: 4, rating5: 4.4, refundable: true, bookingUrl: "https://example.com/brickell" });
    // No total_rate: per night × 4 nights. Property flag overrides the filter.
    expect(offers[1]).toMatchObject({ total: 4080, pricePerNight: 1020, stars: 3, refundable: false });
  });

  it("asks for free cancellation and 3★+", () => {
    const p = serpHotelParams(q, "k");
    expect(p.get("engine")).toBe("google_hotels");
    expect(p.get("free_cancellation")).toBe("true");
    expect(p.get("hotel_class")).toBe("3,4,5");
    expect(p.get("check_in_date")).toBe("2027-03-25");
  });

  it("fails soft", async () => {
    expect(await hotelProvider({}).search(q)).toMatchObject({ ok: false, notConfigured: true });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "Invalid API key" }), { status: 401 }));
    const p = new SerpApiHotelProvider({ apiKey: "bad", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await p.search(q)).toMatchObject({ ok: false, error: "Invalid API key" });
  });
});
