import { describe, expect, it, vi } from "vitest";
import type { FlightQuery } from "@rave-run/core";
import { FastFlightsProvider, flightProviders } from "../src";

const q: FlightQuery = { origins: ["BOS", "JFK"], destinations: ["MIA", "FLL"], outboundDate: "2027-03-25", returnDate: "2027-03-29", adults: 1, cabin: "economy", currency: "USD" };
const ok = (price: number, origin: string, destination: string) => ({
  ok: true,
  url: "https://www.google.com/travel/flights/search?tfs=X",
  offers: [{ price, currency: "USD", origin, destination, airlines: ["DemoAir"], stops: 0, minutes: 200, legs: [] }],
});

describe("FastFlightsProvider", () => {
  it("asks the sidecar once per airport pair and costs that many requests", async () => {
    const bodies: { origin: string; destination: string }[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body));
      bodies.push(b);
      return new Response(JSON.stringify(ok(b.origin === "JFK" ? 380 : 427, b.origin, b.destination)));
    });
    const p = new FastFlightsProvider({ baseUrl: "http://flights-free:8080/", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(p.cost(q)).toBe(4);
    const r = await p.search(q);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://flights-free:8080/search");
    expect(bodies.map((b) => `${b.origin}-${b.destination}`)).toEqual(["BOS-MIA", "BOS-FLL", "JFK-MIA", "JFK-FLL"]);
    expect(bodies[0]).toMatchObject({ outbound: "2027-03-25", return: "2027-03-29", adults: 1, cabin: "economy" });
    expect(r.ok && r.offers.map((o) => o.price).sort()).toEqual([380, 380, 427, 427]);
    expect(r.ok && r.offers[0]).toMatchObject({ provider: "google_flights_free", carrier: "DemoAir", bookingUrl: expect.stringContaining("tfs=") });
  });

  it("keeps partial results, fails only when every pair fails", async () => {
    let n = 0;
    const partial = vi.fn(async () => new Response(JSON.stringify(++n === 1 ? { ok: false, kind: "blocked", error: "429" } : ok(400, "BOS", "MIA"))));
    const r1 = await new FastFlightsProvider({ baseUrl: "http://x", fetchImpl: partial as unknown as typeof fetch }).search(q);
    expect(r1.ok).toBe(true);
    const allBad = vi.fn(async () => new Response(JSON.stringify({ ok: false, kind: "parse", error: "layout changed" })));
    const r2 = await new FastFlightsProvider({ baseUrl: "http://x", fetchImpl: allBad as unknown as typeof fetch }).search(q);
    expect(r2).toMatchObject({ ok: false, error: expect.stringContaining("parse: layout changed") });
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await new FastFlightsProvider({ baseUrl: "http://x", fetchImpl: down as unknown as typeof fetch }).search(q)).toMatchObject({ ok: false, error: expect.stringContaining("sidecar unreachable") });
  });

  it("chooses sources: free first with SerpApi fallback", () => {
    expect(flightProviders({ FAST_FLIGHTS_URL: "http://f", SERPAPI_KEY: "k" })).toMatchObject({ primary: { info: { name: "google_flights_free" } }, fallback: { info: { name: "serpapi_google_flights" } } });
    expect(flightProviders({ FAST_FLIGHTS_URL: "http://f" }).fallback).toBeUndefined();
    expect(flightProviders({ SERPAPI_KEY: "k" }).primary.info.name).toBe("serpapi_google_flights");
    expect(flightProviders({ FAST_FLIGHTS_URL: "http://f", SERPAPI_KEY: "k", FLIGHT_SOURCE: "serpapi" }).primary.info.name).toBe("serpapi_google_flights");
    expect(flightProviders({}).primary.info.configured).toBe(false);
    expect(flightProviders({ FAST_FLIGHTS_URL: "http://f", SERPAPI_KEY: "k", FLIGHT_SOURCE: "paid" })).toMatchObject({ primary: { info: { name: "serpapi_google_flights" } }, fallback: { info: { name: "google_flights_free" } } });
  });
});
