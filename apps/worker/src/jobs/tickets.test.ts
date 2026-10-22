// Integration test: needs TEST_DATABASE_URL pointing at a migrated, disposable database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, createTripFromEvent, day, recordTicketPrice } from "@rave-run/db";
import type { TicketPlatformId } from "@rave-run/core";
import type { TicketCheck, TicketChecker, TicketMatch } from "@rave-run/providers";
import { runTicketJob } from "./tickets";

const url = process.env.TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : (null as unknown as PrismaClient);

function fake(platform: TicketPlatformId, result: (call: number) => Partial<TicketCheck> & { ok: boolean }, find?: TicketMatch | null): TicketChecker & { calls: number } {
  const c = {
    platform,
    configured: true,
    envKeys: [],
    calls: 0,
    find: find === undefined ? undefined : async () => find,
    async check(): Promise<TicketCheck> {
      c.calls++;
      return { platform, url: `https://${platform}.test/e`, feesIncluded: false, ...result(c.calls) } as TicketCheck;
    },
  };
  return c;
}

describe.skipIf(!url)("ticket job", () => {
  let eventId = "";
  beforeAll(async () => {
    await prisma.alert.deleteMany();
    await prisma.ticketPrice.deleteMany();
    await prisma.ticketWatch.deleteMany();
    await prisma.priceSnapshot.deleteMany();
    await prisma.lineItem.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.event.deleteMany();
    await prisma.providerRun.deleteMany();
    const ev = await prisma.event.create({
      data: { name: "Time Warp NYC", city: "Brooklyn", startDate: day("2026-11-20"), endDate: day("2026-11-21"), airports: [], ticketTarget: 200 },
    });
    eventId = ev.id;
    await createTripFromEvent(prisma, ev.id, { status: "planned" });
  });
  afterAll(() => prisma.$disconnect());

  it("finds, checks, converts to all-in, and alerts", async () => {
    const checkers = {
      ticketmaster: fake("ticketmaster", (n) => ({ ok: true, listed: 150, status: n === 1 ? "offsale" : "onsale" }), { url: "https://tm/e", externalId: "tm1" }),
      seatgeek: fake("seatgeek", () => ({ ok: true, listed: 200 }), null), // not listed
      stubhub: fake("stubhub", () => ({ ok: false, error: "site blocked", blocked: true })),
      vividseats: fake("vividseats", () => ({ ok: true, listed: 180 })),
      crowdvolt: fake("crowdvolt", () => ({ ok: true, listed: 170, highestBid: 160 })),
      dice: fake("dice", () => ({ ok: false, error: "no page", noPrice: true })),
      ra: fake("ra", () => ({ ok: false, error: "no page", noPrice: true })),
      radiate: fake("radiate", () => ({ ok: false, error: "manual" })),
    } as Record<TicketPlatformId, TicketChecker & { calls: number }>;
    const pages: Record<string, string> = { "stubhub.com": "https://stubhub.test/e", "vividseats.com": "https://vivid.test/e", "crowdvolt.com": "https://cv.test/e" };
    const findPage = async (_e: unknown, domain: string) => (pages[domain] ? { url: pages[domain] } : null);

    // A Radiate price logged by hand: shown, never counted.
    const radiate = await prisma.ticketWatch.findFirst({ where: { eventId, platform: "radiate" } });
    expect(radiate).toBeNull(); // created by the job

    const r1 = await runTicketJob(prisma, checkers, { now: new Date("2026-10-22T12:00:00Z"), findPage, findBudget: 10, log: () => {} });
    expect(r1.events).toBe(1);
    const watches = await prisma.ticketWatch.findMany({ where: { eventId } });
    const by = Object.fromEntries(watches.map((w) => [w.platform, w]));
    expect(Object.keys(by).sort()).toEqual(["crowdvolt", "dice", "ra", "radiate", "seatgeek", "stubhub", "ticketmaster", "vividseats"]);
    expect(by.ticketmaster).toMatchObject({ externalId: "tm1", status: "ok", officialState: "offsale" });
    expect(by.seatgeek.status).toBe("not_listed");
    expect(by.stubhub.status).toBe("blocked");
    expect(by.radiate.status).toBe("manual");
    expect(checkers.radiate.calls).toBe(0);

    // All-in: Ticketmaster $150 + 22% = 183; Vivid $180 + 30% = 234; CrowdVolt $170 + 8% = 183.6
    const prices = await prisma.ticketPrice.findMany({ where: { eventId } });
    const allIn = Object.fromEntries(prices.map((p) => [p.platform, Number(p.allInPrice)]));
    expect(allIn).toEqual({ ticketmaster: 183, vividseats: 234, crowdvolt: 183.6 });

    // Target $200: TM 183 qualifies. CrowdVolt ask 170 vs bid 160 → gap alert.
    const kinds = (await prisma.alert.findMany({ where: { dismissedAt: null } })).map((a) => a.kind).sort();
    expect(kinds).toEqual(["crowdvolt_gap", "ticket_target"]);

    await recordTicketPrice(prisma, by.radiate, { listed: 90, feesIncluded: true, source: "manual", observedAt: new Date("2026-10-22T13:00:00Z") });

    // Next day: Ticketmaster flips offsale → onsale; no duplicate target/gap alerts.
    const r2 = await runTicketJob(prisma, checkers, { now: new Date("2026-10-23T12:00:00Z"), findPage, log: () => {} });
    expect(r2.alerts).toBe(1);
    const open = await prisma.alert.findMany({ where: { dismissedAt: null } });
    expect(open.map((a) => a.kind).sort()).toEqual(["crowdvolt_gap", "ticket_onsale", "ticket_target"]);
    // The $90 Radiate price never became the target alert's price.
    expect(open.find((a) => a.kind === "ticket_target")?.title).toContain("Ticketmaster");
  });
});
