// Integration test: needs TEST_DATABASE_URL pointing at a migrated, disposable database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, createTripFromEvent, day } from "@rave-run/db";
import type { FlightOffer, FlightQuery } from "@rave-run/core";
import type { FlightProvider, ProviderResult } from "@rave-run/providers";
import { runSavingsCheck } from "./savings";

const url = process.env.TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : (null as unknown as PrismaClient);

const paid = (price: number): FlightProvider & { calls: FlightQuery[] } => {
  const calls: FlightQuery[] = [];
  return {
    calls,
    info: { name: "serpapi_google_flights", tier: "free", configured: true, envKeys: [] },
    cost: () => 1,
    async search(q): Promise<ProviderResult<FlightOffer>> {
      calls.push(q);
      return { ok: true, provider: "serpapi_google_flights", cached: false, fetchedAt: new Date("2026-12-01T12:00:00Z"), raw: {}, offers: [{ provider: "x", price, currency: "USD", origin: "BOS", destination: "MIA", outboundDate: q.outboundDate, returnDate: q.returnDate, stops: 0, carrier: "AA", insightLabel: "typical" }] };
    },
  };
};

describe.skipIf(!url)("savings meter", () => {
  const now = new Date("2026-12-01T12:00:00Z");
  let itemId = "";
  beforeAll(async () => {
    for (const t of ["savingsMeter", "arrivalGuide", "alert", "priceSnapshot", "lineItem", "trip", "event", "providerRun", "setting"] as const) {
      await (prisma[t] as unknown as { deleteMany: () => Promise<unknown> }).deleteMany();
    }
    const ev = await prisma.event.create({ data: { name: "Ultra Save", city: "Miami", startDate: day("2027-03-26"), endDate: day("2027-03-28"), airports: ["MIA"], genres: [], lineupHighlights: [] } });
    const trip = await createTripFromEvent(prisma, ev.id, { status: "planned" });
    itemId = trip.lineItems.find((l) => l.kind === "flight")!.id;
    await prisma.priceSnapshot.create({
      data: {
        lineItemId: itemId, provider: "google_flights_free", price: 427, totalPrice: 427, outboundDate: day("2027-03-25"), returnDate: day("2027-03-29"), variant: "base", fetchedAt: new Date("2026-12-01T10:00:00Z"),
        query: { origins: ["BOS", "JFK"], destinations: ["MIA"], outboundDate: "2027-03-25", returnDate: "2027-03-29", adults: 1, cabin: "economy", currency: "USD" },
      },
    });
  });
  afterAll(() => prisma.$disconnect());

  it("re-checks a free-source price with SerpApi, records both, and uses the cheaper quote", async () => {
    const p = paid(398);
    const r = await runSavingsCheck(prisma, p, { now, log: () => {} });
    expect(r.compared).toBe(1);
    expect(p.calls[0].origins).toEqual(["BOS", "JFK"]);
    const m = await prisma.savingsMeter.findFirstOrThrow();
    expect([Number(m.freeBestPrice), Number(m.paidBestPrice)]).toEqual([427, 398]);
    expect(Number((await prisma.lineItem.findUniqueOrThrow({ where: { id: itemId } })).quotedAmount)).toBe(398);
    // Once per item per day; and it counts against the SerpApi allowance.
    expect((await runSavingsCheck(prisma, paid(390), { now, log: () => {} })).compared).toBe(0);
    expect(await prisma.providerRun.count({ where: { provider: "serpapi_google_flights", queries: 1 } })).toBe(1);
  });

  it("does nothing on the paid tier or without a key", async () => {
    await prisma.setting.create({ data: { key: "dataTier", value: "paid" } });
    expect(await runSavingsCheck(prisma, paid(1), { now, log: () => {} })).toMatchObject({ compared: 0, skipped: "paid tier on" });
    await prisma.setting.deleteMany();
    const off = { ...paid(1), info: { name: "none", tier: "free" as const, configured: false, envKeys: [] } };
    expect(await runSavingsCheck(prisma, off, { now, log: () => {} })).toMatchObject({ skipped: "no SerpApi key" });
  });
});
