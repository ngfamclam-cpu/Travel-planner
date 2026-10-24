// Integration test: needs TEST_DATABASE_URL pointing at a migrated, disposable database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@rave-run/db";
import { addDays, type AsiaSeries } from "@rave-run/core";
import type { CalendarResult } from "@rave-run/providers";
import { runAsia } from "./asia";

const url = process.env.TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : (null as unknown as PrismaClient);

describe.skipIf(!url)("Explore Asia job", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  beforeAll(async () => {
    await prisma.asiaFare.deleteMany();
    await prisma.asiaScan.deleteMany();
    await prisma.providerRun.deleteMany();
    await prisma.setting.deleteMany();
  });
  afterAll(async () => prisma.$disconnect());

  it("fills every slice on first run, then keeps previous/lowest prices and drops vanished dates", async () => {
    const calls: AsiaSeries["request"][] = [];
    let base = 1000;
    const calendar = async (req: AsiaSeries["request"]): Promise<CalendarResult> => {
      calls.push(req);
      if ([...req.origins, ...req.destinations].includes("PVG")) return { ok: true, prices: [] }; // no nonstop
      const prices = [];
      for (let d = req.from; d <= req.to; d = addDays(d, 1)) prices.push({ date: d, return: req.trip === "round" ? addDays(d, req.nights) : undefined, price: base });
      return { ok: true, prices };
    };
    const first = await runAsia(prisma, { calendar }, { now, log: () => {} });
    expect(first.scanned).toBe(144);
    expect(calls.every((c) => c.nonstop)).toBe(true);
    const tokyo = await prisma.asiaFare.findFirst({ where: { kind: "round", origin: "BOS", city: "TYO", nights: 7, date: new Date("2026-11-15") } });
    expect(tokyo!.returnDate!.toISOString().slice(0, 10)).toBe("2026-11-22");
    expect(await prisma.asiaFare.count({ where: { city: "SHA" } })).toBe(0);

    // Nothing is due the next hour.
    expect((await runAsia(prisma, { calendar }, { now: new Date(now.getTime() + 3_600_000), log: () => {} })).scanned).toBe(0);

    // Three days later: prices drop and the 20th of each month loses its nonstop.
    base = 900;
    const later = new Date(now.getTime() + 3 * 86_400_000);
    const cal2 = async (req: AsiaSeries["request"]): Promise<CalendarResult> => {
      const r = await calendar(req);
      return r.ok ? { ok: true, prices: r.prices.filter((p) => !p.date.endsWith("-20")) } : r;
    };
    const second = await runAsia(prisma, { calendar: cal2 }, { now: later, log: () => {} });
    expect(second.scanned).toBe(80); // the daily budget
    const again = await prisma.asiaFare.findUnique({ where: { id: tokyo!.id } });
    expect([Number(again!.price), Number(again!.prevPrice), Number(again!.lowPrice), Number(again!.highPrice)]).toEqual([900, 1000, 900, 1000]);
    expect(await prisma.asiaFare.count({ where: { kind: "round", origin: "BOS", city: "TYO", nights: 7, date: new Date("2026-11-20") } })).toBe(0);
    // Past dates are pruned.
    expect(await prisma.asiaFare.count({ where: { date: { lt: new Date("2026-10-26") } } })).toBe(0);
  });

  it("treats all-empty answers as a failure and retries them next run", async () => {
    await prisma.asiaFare.deleteMany();
    await prisma.asiaScan.deleteMany();
    const empty = async (): Promise<CalendarResult> => ({ ok: true, prices: [] });
    await runAsia(prisma, { calendar: empty }, { now, log: () => {} });
    const run = await prisma.providerRun.findFirst({ where: { kind: "asia" }, orderBy: { startedAt: "desc" } });
    expect(run).toMatchObject({ ok: false, results: 0 });
    expect((await runAsia(prisma, { calendar: empty }, { now: new Date(now.getTime() + 3_600_000), log: () => {} })).scanned).toBe(144);
  });

  it("stops after repeated failures and records the error", async () => {
    await prisma.asiaScan.deleteMany();
    let n = 0;
    const res = await runAsia(prisma, { calendar: async () => (n++, { ok: false, kind: "blocked", error: "429" }) }, { now, log: () => {} });
    expect(n).toBe(3);
    expect(res.scanned).toBe(3);
    const run = await prisma.providerRun.findFirst({ where: { kind: "asia" }, orderBy: { startedAt: "desc" } });
    expect(run).toMatchObject({ ok: false });
  });
});
