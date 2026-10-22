// Integration test: needs TEST_DATABASE_URL pointing at a migrated, disposable database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@rave-run/db";
import type { FlightOffer, FlightQuery } from "@rave-run/core";
import type { FlightProvider, ProviderResult } from "@rave-run/providers";
import { createTripFromEvent, day } from "@rave-run/db";
import { runFlightJob } from "./flights";

const url = process.env.TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : (null as unknown as PrismaClient);

class FakeFlights implements FlightProvider {
  info = { name: "fake", tier: "free" as const, configured: true, envKeys: [] };
  queries: FlightQuery[] = [];
  async search(q: FlightQuery): Promise<ProviderResult<FlightOffer>> {
    this.queries.push(q);
    // JFK is cheaper on fare but positioning ($60) makes BOS win; baseline weeks are cheap.
    const baseline = q.outboundDate > "2027-04-01";
    const mk = (origin: string, price: number): FlightOffer => ({
      provider: "fake", price, currency: "USD", origin, destination: "MIA",
      outboundDate: q.outboundDate, returnDate: q.returnDate, stops: 0, carrier: "Test Air", insightLabel: "high",
    });
    return {
      ok: true, provider: "fake", cached: false, fetchedAt: new Date(), raw: { q },
      offers: baseline ? [mk("BOS", 200)] : [mk("BOS", 427), mk("JFK", 390)],
    };
  }
}

describe.skipIf(!url)("flight job", () => {
  let itemId = "";
  beforeAll(async () => {
    await prisma.priceSnapshot.deleteMany();
    await prisma.lineItem.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.event.deleteMany();
    await prisma.providerRun.deleteMany();
    const ev = await prisma.event.create({
      data: { name: "Ultra Test", city: "Miami", startDate: day("2027-03-26"), endDate: day("2027-03-28"), airports: ["MIA", "FLL"] },
    });
    const trip = await createTripFromEvent(prisma, ev.id, { status: "planned" });
    itemId = trip.lineItems.find((l) => l.kind === "flight")!.id;
  });
  afterAll(() => prisma.$disconnect());

  it("creates the trip on the event window", async () => {
    const trip = await prisma.trip.findFirstOrThrow();
    expect(trip.arriveDate.toISOString().slice(0, 10)).toBe("2027-03-25");
    expect(trip.departDate.toISOString().slice(0, 10)).toBe("2027-03-29");
  });

  it("searches the event window, stores snapshots, sets quote and baseline", async () => {
    const fake = new FakeFlights();
    const r = await runFlightJob(prisma, fake, { budget: 4, now: new Date("2026-10-22T12:00:00Z"), log: () => {} });
    expect(r.snapshots).toBe(4);
    expect(fake.queries[0]).toMatchObject({ outboundDate: "2027-03-25", returnDate: "2027-03-29", destinations: ["MIA", "FLL"] });
    expect(fake.queries[0].origins).toContain("JFK");
    expect(fake.queries.some((q) => q.outboundDate === "2027-04-15")).toBe(true); // baseline 3 weeks later

    const li = await prisma.lineItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(Number(li.quotedAmount)).toBe(427); // BOS 427 beats JFK 390 + 60
    expect(li.quotedSource).toContain("from BOS");
    expect(Number(li.baselinePrice)).toBe(200);
    expect(li.isEstimate).toBe(false);

    const run = await prisma.providerRun.findFirstOrThrow({ where: { provider: "fake" } });
    expect(run).toMatchObject({ ok: true, queries: 4, results: 4 });
  });

  it("doesn't repeat variants within 20 hours", async () => {
    const fake = new FakeFlights();
    await runFlightJob(prisma, fake, { budget: 4, now: new Date("2026-10-22T13:00:00Z"), log: () => {} });
    expect(fake.queries.some((q) => q.outboundDate === "2027-03-25" && q.returnDate === "2027-03-29")).toBe(false);
  });

  it("free source: narrows origins on other date cards and fails over to SerpApi", async () => {
    await prisma.priceSnapshot.deleteMany();
    await prisma.providerRun.deleteMany();
    const queries: FlightQuery[] = [];
    const free: FlightProvider = {
      info: { name: "google_flights_free", tier: "free", configured: true, envKeys: [], costPerPair: true },
      cost: (q) => q.origins.length * q.destinations.length,
      search: async (q) => {
        queries.push(q);
        return { ok: false, provider: "google_flights_free", error: "parse: layout changed" };
      },
    };
    const serp = new FakeFlights();
    const r = await runFlightJob(prisma, free, { budget: 200, fallback: serp, failoverAfter: 2, now: new Date("2026-10-24T12:00:00Z"), log: () => {} });
    expect(queries).toHaveLength(2);
    expect(queries[0].origins).toEqual(["BOS", "PVD", "MHT", "JFK", "EWR", "LGA"]); // chosen dates: all airports
    expect(queries[1].origins).toEqual(["BOS"]); // other cards: BOS (+ last winner)
    expect(serp.queries.length).toBeGreaterThan(0);
    expect(r.snapshots).toBe(serp.queries.length);
    const runs = await prisma.providerRun.findMany({ orderBy: { provider: "asc" } });
    expect(runs.map((x) => [x.provider, x.ok, x.queries])).toEqual([
      ["fake", true, serp.queries.length],
      ["google_flights_free", false, 0],
    ]);
  });

  it("records a failed run when not configured", async () => {
    const off: FlightProvider = { info: { name: "none", tier: "free", configured: false, envKeys: ["SERPAPI_KEY"] }, search: async () => ({ ok: false, provider: "none", error: "x" }) };
    const r = await runFlightJob(prisma, off, { log: () => {} });
    expect(r.skippedReason).toContain("SERPAPI_KEY");
    expect(await prisma.providerRun.count({ where: { provider: "none", ok: false } })).toBe(1);
  });
});
