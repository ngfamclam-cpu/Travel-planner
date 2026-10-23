// Integration test: needs TEST_DATABASE_URL pointing at a migrated, disposable database.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, day } from "@rave-run/db";
import { runImages } from "./images";

const url = process.env.TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : (null as unknown as PrismaClient);
const PNG = Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG\r\n\x1a\n"), Buffer.alloc(20)]);

describe.skipIf(!url)("site images", () => {
  beforeAll(async () => {
    for (const t of ["media", "ticketPrice", "ticketWatch", "lineItem", "trip", "event", "providerRun"] as const) {
      await (prisma[t] as unknown as { deleteMany: () => Promise<unknown> }).deleteMany();
    }
    await prisma.event.create({ data: { name: "Ultra Img", city: "Miami", officialUrl: "https://ultramusicfestival.com", startDate: day("2027-03-26"), endDate: day("2027-03-28"), airports: [], genres: [], lineupHighlights: [] } });
    await prisma.event.create({ data: { name: "No Site", city: "X", startDate: day("2027-03-26"), endDate: day("2027-03-28"), airports: [], genres: [], lineupHighlights: [] } });
  });
  afterAll(() => prisma.$disconnect());

  it("saves each site's preview image and icon, platform logos, and doesn't refetch for a month", async () => {
    const pageImageUrls = vi.fn(async (u: string) => ({ hero: `${u}/hero.jpg`, icon: `${u}/icon.png` }));
    const fetchImage = vi.fn(async (u: string) => ({ url: u, contentType: "image/png", data: PNG }));
    const now = new Date("2026-12-01T12:00:00Z");
    const r = await runImages(prisma, { pageImageUrls, fetchImage }, { now, log: () => {} });
    expect(r).toMatchObject({ checked: 1, found: 1 });
    const ev = await prisma.event.findFirstOrThrow({ where: { name: "Ultra Img" } });
    const hero = await prisma.media.findUniqueOrThrow({ where: { id: ev.heroMediaId! } });
    expect(hero).toMatchObject({ key: `event-${ev.id}-hero`, sourceUrl: "https://ultramusicfestival.com/hero.jpg", contentType: "image/png" });
    expect(await prisma.media.findUnique({ where: { key: "platform-ticketmaster-icon" } })).not.toBeNull();
    expect(pageImageUrls).toHaveBeenCalledWith("https://ticketmaster.com");
    // A week later: nothing due
    expect((await runImages(prisma, { pageImageUrls, fetchImage }, { now: new Date("2026-12-08T12:00:00Z"), log: () => {} })).checked).toBe(0);
  });

  it("keeps going when a site blocks or serves a bad image", async () => {
    await prisma.event.updateMany({ data: { imagesCheckedAt: null } });
    const r = await runImages(prisma, { pageImageUrls: async () => { throw new Error("page HTTP 403"); }, fetchImage: async () => { throw new Error("x"); } }, { onlyNew: true, log: () => {} });
    expect(r.failures[0]).toContain("page HTTP 403");
    const ev = await prisma.event.findFirstOrThrow({ where: { name: "Ultra Img" } });
    expect(ev.heroMediaId).not.toBeNull(); // the earlier image is kept
    expect(ev.imagesCheckedAt).not.toBeNull();
  });
});
