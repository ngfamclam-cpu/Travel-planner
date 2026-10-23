// Integration test: needs TEST_DATABASE_URL pointing at a migrated, disposable database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, createTripFromEvent, day } from "@rave-run/db";
import { runSignals } from "./signals";

const url = process.env.TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : (null as unknown as PrismaClient);

describe.skipIf(!url)("signals job", () => {
  const now = new Date("2026-12-01T12:00:00Z");
  let ids: Record<string, string> = {};
  beforeAll(async () => {
    for (const t of ["alert", "ticketPrice", "ticketWatch", "ticketTier", "priceSnapshot", "lineItem", "trip", "event"] as const) {
      await (prisma[t] as unknown as { deleteMany: () => Promise<unknown> }).deleteMany();
    }
    const ev = await prisma.event.create({
      data: { name: "HiJinx Test", city: "Miami", country: "US", startDate: day("2027-01-21"), endDate: day("2027-01-22"), airports: ["MIA"], genres: [], lineupHighlights: [] },
    });
    await prisma.ticketTier.createMany({
      data: [
        { eventId: ev.id, name: "2-day GA", priceAllIn: 215, onSale: true, source: "official", observedAt: now },
        { eventId: ev.id, name: "GA resale", priceAllIn: 282, isResale: true, onSale: true, source: "resale", observedAt: now },
      ],
    });
    const trip = await createTripFromEvent(prisma, ev.id, { status: "planned" });
    ids = Object.fromEntries(trip.lineItems.map((l) => [l.kind, l.id]));
    // Flight: a week of prices for the chosen dates, today's the lowest.
    for (const [i, p] of [470, 460, 440, 450, 445, 430, 410].entries()) {
      await prisma.priceSnapshot.create({
        data: {
          lineItemId: ids.flight, query: {}, provider: "x", price: p, totalPrice: p, outboundDate: day("2027-01-20"), returnDate: day("2027-01-23"),
          fetchedAt: new Date(now.getTime() - (6 - i) * 86_400_000),
        },
      });
    }
    await prisma.lineItem.update({ where: { id: ids.hotel }, data: { quotedAmount: 250, quotedAt: now, quotedSource: "Google Hotels via SerpApi (Cheapest: Hotel Z, 4★, 4.3/5, free cancellation)" } });
  });
  afterAll(() => prisma.$disconnect());

  it("sets a signal and reason on every item and alerts on BUY NOW for planned trips", async () => {
    const r = await runSignals(prisma, { now, log: () => {} });
    const items = await prisma.lineItem.findMany();
    const by = Object.fromEntries(items.map((l) => [l.kind, l]));
    expect(by.flight).toMatchObject({ signal: "BUY_NOW", signalReason: "$410 is the lowest since tracking started 7 days ago" });
    expect(by.hotel).toMatchObject({ signal: "BUY_NOW", signalReason: expect.stringContaining("Hotel Z, $250/night") });
    expect(by.ticket).toMatchObject({ signal: "BUY_NOW", signalReason: "Face value $215, resale already $282+" });
    expect(r.alerts).toBe(3);

    // Same day again: no new alerts. Switched-off items are DONE and never alert.
    await prisma.lineItem.update({ where: { id: ids.ground }, data: { included: false } });
    const r2 = await runSignals(prisma, { now, log: () => {} });
    expect(r2.alerts).toBe(0);
  });
});
