import { describe, expect, it, vi } from "vitest";
import { cheapestWithPositioning, type FlightQuery } from "@rave-run/core";
import { parseSerpFlights, SerpApiFlightProvider, flightProvider, type QueryCacheStore } from "../src";
import fixture from "./serpapi.fixture.json";

const q: FlightQuery = {
  origins: ["BOS", "JFK"],
  destinations: ["MIA", "FLL"],
  outboundDate: "2027-03-25",
  returnDate: "2027-03-29",
  adults: 1,
  cabin: "economy",
  currency: "USD",
};

describe("SerpApi Google Flights parsing", () => {
  it("parses offers with Google's insight label", () => {
    const offers = parseSerpFlights(fixture, q);
    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({ price: 427, origin: "BOS", destination: "MIA", stops: 0, carrier: "American", insightLabel: "high" });
    expect(offers[1]).toMatchObject({ price: 389, origin: "JFK", destination: "FLL", stops: 1, carrier: "Delta" });
  });

  it("positioning cost can flip the winner back to Boston", () => {
    const best = cheapestWithPositioning(parseSerpFlights(fixture, q), (a) => (a === "JFK" ? 60 : 0));
    expect(best).toMatchObject({ origin: "BOS", total: 427 });
  });
});

describe("SerpApiFlightProvider", () => {
  it("fails soft without a key", async () => {
    const r = await flightProvider({}).search(q);
    expect(r).toMatchObject({ ok: false, notConfigured: true });
  });

  it("calls the API once with combined airports and caches", async () => {
    const store = new Map<string, unknown>();
    const cache: QueryCacheStore = {
      get: async (k) => (store.has(k) ? { response: store.get(k), fetchedAt: new Date() } : null),
      set: async (k, _p, v) => void store.set(k, v),
    };
    const fetchImpl = vi.fn(async (_url: string) => new Response(JSON.stringify(fixture), { status: 200 }));
    const p = new SerpApiFlightProvider({ apiKey: "k", cache, fetchImpl: fetchImpl as unknown as typeof fetch });

    const r1 = await p.search(q);
    expect(r1.ok && r1.offers.length).toBe(2);
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.searchParams.get("departure_id")).toBe("BOS,JFK");
    expect(url.searchParams.get("arrival_id")).toBe("MIA,FLL");
    expect(url.searchParams.get("type")).toBe("1");

    const r2 = await p.search(q);
    expect(r2.ok && r2.cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("splits per airport pair when combining is off, and survives partial failures", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () =>
      ++n === 1 ? new Response(JSON.stringify({ error: "Invalid departure_id" }), { status: 400 }) : new Response(JSON.stringify(fixture)),
    );
    const p = new SerpApiFlightProvider({ apiKey: "k", combineAirports: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await p.search(q);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(r.ok).toBe(true);
  });

  it("returns an error result (not a throw) when every call fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));
    const p = new SerpApiFlightProvider({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await p.search(q)).toMatchObject({ ok: false, error: expect.stringContaining("HTTP 500") });
  });
});
