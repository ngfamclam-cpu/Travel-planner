// Integration test: needs TEST_DATABASE_URL pointing at a migrated, disposable database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, createTripFromEvent, day } from "@rave-run/db";
import type { HotelOffer, HotelQuery } from "@rave-run/core";
import type { HotelProvider, ProviderResult } from "@rave-run/providers";
import { runHotelJob } from "./hotels";

const url = process.env.TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : (null as unknown as PrismaClient);

class FakeHotels implements HotelProvider {
  info = { name: "fake_hotels", tier: "free" as const, configured: true, envKeys: [] };
  queries: HotelQuery[] = [];
  constructor(private prices: Record<string, number>) {}
  async search(q: HotelQuery): Promise<ProviderResult<HotelOffer>> {
    this.queries.push(q);
    const baseline = q.checkIn > "2027-04-01";
    const mk = (name: string, total: number, extra: Partial<HotelOffer> = {}): HotelOffer => ({
      provider: "fake", name, total, pricePerNight: total / 4, currency: "USD", stars: 4, rating5: 4.3, refundable: true, ...extra,
    });
    const offers = baseline
      ? [mk("Normal Week Hotel", 640)]
      : [mk("Hotel A", this.prices.A), mk("Hotel B", this.prices.B), mk("Dive", 300, { stars: 2 }), mk("Hotel C", this.prices.C), mk("Hotel D", 3000)];
    return { ok: true, provider: "fake", cached: false, fetchedAt: new Date(), raw: { q }, offers };
  }
}

describe.skipIf(!url)("hotel job", () => {
  let itemId = "";
  const now = new Date("2026-10-22T12:00:00Z");
  beforeAll(async () => {
    await prisma.alert.deleteMany();
    await prisma.priceSnapshot.deleteMany();
    await prisma.lineItem.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.event.deleteMany();
    await prisma.providerRun.deleteMany();
    const ev = await prisma.event.create({
      data: { name: "Ultra Hotel Test", city: "Miami", venue: "Bayfront Park", startDate: day("2027-03-26"), endDate: day("2027-03-28"), airports: ["MIA"] },
    });
    const trip = await createTripFromEvent(prisma, ev.id, { status: "planned" });
    itemId = trip.lineItems.find((l) => l.kind === "hotel")!.id;
  });
  afterAll(() => prisma.$disconnect());

  it("prices the exact nights near the venue, keeps the top 3, sets per-night quote and surge baseline", async () => {
    const fake = new FakeHotels({ A: 1600, B: 1400, C: 1500 });
    const r = await runHotelJob(prisma, fake, { budget: 5, now, log: () => {} });
    expect(fake.queries[0]).toMatchObject({ location: "hotels near Bayfront Park, Miami", checkIn: "2027-03-25", checkOut: "2027-03-29" });
    expect(r.snapshots).toBe(4); // 3 options + 1 baseline
    const li = await prisma.lineItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(li.qty).toBe(4);
    expect(Number(li.quotedAmount)).toBe(350); // Hotel B 1400 / 4 nights
    expect(li.quotedSource).toContain("Hotel B");
    expect(Number(li.baselinePrice)).toBe(160); // 640 / 4 → surge 2.2×
  });

  it("raises one rebook alert when a same-or-better refundable rate drops", async () => {
    await prisma.lineItem.update({
      where: { id: itemId },
      data: { bookedAmount: 350, booking: { hotelName: "Hotel B", stars: 4, rating5: 4.3, refundable: true, cancelBy: "2027-03-20" } },
    });
    const later = new Date("2026-10-23T12:00:00Z");
    const r = await runHotelJob(prisma, new FakeHotels({ A: 1600, B: 1250, C: 1500 }), { budget: 5, now: later, log: () => {} });
    expect(r.alerts).toBe(1);
    const alert = await prisma.alert.findFirstOrThrow({ where: { kind: "rebook" } });
    expect(Number(alert.amount)).toBe(150);
    expect(alert.body).toContain("before 2027-03-20");
    // Same result next day: no duplicate alert.
    const again = await runHotelJob(prisma, new FakeHotels({ A: 1600, B: 1250, C: 1500 }), { budget: 5, now: new Date("2026-10-24T12:00:00Z"), log: () => {} });
    expect(again.alerts).toBe(0);
    // A bigger drop replaces the open alert; a smaller one doesn't add another.
    const bigger = await runHotelJob(prisma, new FakeHotels({ A: 1600, B: 1100, C: 1500 }), { budget: 5, now: new Date("2026-10-25T12:00:00Z"), log: () => {} });
    expect(bigger.alerts).toBe(1);
    const smaller = await runHotelJob(prisma, new FakeHotels({ A: 1600, B: 1200, C: 1500 }), { budget: 5, now: new Date("2026-10-26T12:00:00Z"), log: () => {} });
    expect(smaller.alerts).toBe(0);
    const open = await prisma.alert.findMany({ where: { dismissedAt: null } });
    expect(open.map((a) => Number(a.amount))).toEqual([300]);
  });

  it("ignores snapshots for old dates after the trip moves", async () => {
    const trip = await prisma.trip.findFirstOrThrow();
    await prisma.trip.update({ where: { id: trip.id }, data: { departDate: day("2027-03-30") } });
    await prisma.lineItem.update({ where: { id: itemId }, data: { quotedAmount: null, bookedAmount: null, booking: undefined } });
    const { refreshLineItemQuote } = await import("./quotes");
    await refreshLineItemQuote(prisma, itemId, new Date("2026-10-24T13:00:00Z"));
    const li = await prisma.lineItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(li.quotedAmount).toBeNull();
  });
});
