// Integration test: needs TEST_DATABASE_URL pointing at a migrated, disposable database.
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient, day } from "@rave-run/db";
import { runPrune } from "./prune";

const url = process.env.TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : (null as unknown as PrismaClient);

describe.skipIf(!url)("prune", () => {
  afterAll(() => prisma.$disconnect());
  it("drops old raw payloads but keeps the prices", async () => {
    await prisma.priceSnapshot.deleteMany();
    await prisma.lineItem.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.queryCache.deleteMany();
    const trip = await prisma.trip.create({ data: { name: "T", arriveDate: day("2027-03-25"), departDate: day("2027-03-29"), lineItems: { create: [{ kind: "flight", label: "f" }] } }, include: { lineItems: true } });
    const li = trip.lineItems[0].id;
    const now = new Date("2026-11-30T12:00:00Z");
    const snap = (fetchedAt: Date) => prisma.priceSnapshot.create({ data: { lineItemId: li, query: {}, provider: "x", price: 1, totalPrice: 1, fetchedAt, raw: { big: "payload" } } });
    await snap(new Date("2026-10-01T00:00:00Z"));
    await snap(new Date("2026-11-29T00:00:00Z"));
    await prisma.queryCache.create({ data: { key: "k", provider: "x", response: {}, fetchedAt: new Date("2026-11-20T00:00:00Z") } });

    const r = await runPrune(prisma, { now });
    expect(r).toMatchObject({ snapshotsTrimmed: 1, cacheDeleted: 1 });
    const rows = await prisma.priceSnapshot.findMany({ orderBy: { fetchedAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0].raw).toBeNull();
    expect(rows[1].raw).toEqual({ big: "payload" });
  });
});
