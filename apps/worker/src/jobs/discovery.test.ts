// Integration test: needs TEST_DATABASE_URL pointing at a migrated, disposable database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, day } from "@rave-run/db";
import type { DiscoveredEvent } from "@rave-run/core";
import { runDiscovery, type DiscoverySource } from "./discovery";

const url = process.env.TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : (null as unknown as PrismaClient);

const ev = (name: string, start: string, end = start, extra: Partial<DiscoveredEvent> = {}): DiscoveredEvent => ({
  source: "edmtrain", externalId: `${name}-${start}`, name, city: "Legend Valley", country: "US", venue: "Legend Valley", start, end, artists: ["Excision", "Subtronics"], festival: true, url: "https://edmtrain.com/e/1", ...extra,
});

describe.skipIf(!url)("discovery job", () => {
  beforeAll(async () => {
    await prisma.alert.deleteMany();
    await prisma.ticketPrice.deleteMany();
    await prisma.ticketWatch.deleteMany();
    await prisma.lineItem.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.event.deleteMany();
    await prisma.providerRun.deleteMany();
    await prisma.event.create({ data: { name: "Lost Lands", city: "Legend Valley, OH", startDate: day("2027-09-17"), endDate: day("2027-09-19"), datesTentative: true, genres: [], lineupHighlights: [], airports: [] } });
  });
  afterAll(() => prisma.$disconnect());

  it("adds new festivals, fixes tentative dates on known ones, never duplicates", async () => {
    const days = [ev("Lost Lands Music Festival", "2027-09-24"), ev("Lost Lands Music Festival", "2027-09-25"), ev("Lost Lands Music Festival", "2027-09-26")];
    // tentative Sep 17 vs real Sep 24: 7 days apart → too far for a match, so use close dates instead
    const real = days.map((d) => ({ ...d, start: d.start.replace("-24", "-18").replace("-25", "-19").replace("-26", "-20"), end: d.end.replace("-24", "-18").replace("-25", "-19").replace("-26", "-20") }));
    const sources: DiscoverySource[] = [
      { name: "edmtrain", configured: true, envKey: "X", fetch: async () => [...real, ev("Brand New Fest", "2027-07-10", "2027-07-10", { city: "Austin", venue: "Park" })] },
      { name: "ticketmaster", configured: false, envKey: "TICKETMASTER_API_KEY", fetch: async () => [] },
    ];
    const r1 = await runDiscovery(prisma, sources, { now: new Date("2026-10-23T12:00:00Z"), log: () => {} });
    expect(r1).toMatchObject({ found: 2, created: 1, updated: 1 });
    const ll = await prisma.event.findFirstOrThrow({ where: { name: "Lost Lands" } });
    expect([ll.startDate.toISOString().slice(0, 10), ll.endDate.toISOString().slice(0, 10), ll.datesTentative]).toEqual(["2027-09-18", "2027-09-20", false]);
    expect(ll.lineupHighlights).toEqual(["Excision", "Subtronics"]);
    expect(ll.edmtrainUrl).toBe("https://edmtrain.com/e/1");

    const r2 = await runDiscovery(prisma, sources, { now: new Date("2026-10-30T12:00:00Z"), log: () => {} });
    expect(r2.created).toBe(0);
    expect(await prisma.event.count()).toBe(2);
    const runs = await prisma.providerRun.findMany({ where: { kind: "event" } });
    expect(runs.some((x) => x.provider === "ticketmaster" && !x.ok && x.error === "TICKETMASTER_API_KEY not set")).toBe(true);
  });
});
