// Integration test: needs TEST_DATABASE_URL pointing at a migrated, disposable database.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { PrismaClient, createTripFromEvent, day } from "@rave-run/db";
import { briefIfDue, runBrief } from "./brief";
import { writeSummary } from "../brief/summary";
import { buildBriefPayload } from "../brief/payload";

const url = process.env.TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : (null as unknown as PrismaClient);

/** A stand-in Anthropic client that returns fixed text. */
function fakeClient(text: string, stop = "end_turn") {
  const create = vi.fn(async () => ({ stop_reason: stop, content: [{ type: "text", text }] }));
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

describe.skipIf(!url)("daily brief", () => {
  const now = new Date("2026-12-01T13:00:00Z"); // 8:00 AM New York
  beforeAll(async () => {
    for (const t of ["brief", "alert", "ticketPrice", "ticketWatch", "ticketTier", "priceSnapshot", "lineItem", "trip", "event", "providerRun", "setting"] as const) {
      await (prisma[t] as unknown as { deleteMany: () => Promise<unknown> }).deleteMany();
    }
    const ev = await prisma.event.create({ data: { name: "Ultra Test", city: "Miami", startDate: day("2027-03-26"), endDate: day("2027-03-28"), airports: ["MIA"], genres: [], lineupHighlights: [] } });
    const trip = await createTripFromEvent(prisma, ev.id, { status: "planned" });
    const flight = trip.lineItems.find((l) => l.kind === "flight")!;
    await prisma.lineItem.update({ where: { id: flight.id }, data: { quotedAmount: 427, quotedAt: now, signal: "BUY_NOW", signalReason: "$427 is the lowest since tracking started 7 days ago" } });
    await prisma.providerRun.create({ data: { provider: "none", kind: "hotel", ok: false, error: "SERPAPI_KEY not set", startedAt: now } });
    await prisma.providerRun.create({ data: { provider: "google_flights_free", kind: "flight", ok: true, startedAt: now } });
  });
  afterAll(() => prisma.$disconnect());

  it("builds the payload from the database", async () => {
    const p = await buildBriefPayload(prisma, now);
    expect(p.trips[0]).toMatchObject({ name: "Ultra Test", total: 427, buyNow: 1, change: null });
    expect(p.actions[0]).toMatchObject({ kind: "buy_now", detail: "$427 is the lowest since tracking started 7 days ago" });
    expect(p.problems).toContainEqual({ source: "hotel prices (none)", note: "SERPAPI_KEY not set" });
  });

  it("uses Claude's summary when every number checks out", async () => {
    const { client, create } = fakeClient("Buy the Ultra Test flight today: $427 is the lowest since tracking started 7 days ago.");
    const p = await buildBriefPayload(prisma, now);
    const s = await writeSummary(p, { client });
    expect(s.source).toBe("claude");
    const args = (create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(args).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "low" }, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
  });

  it("falls back to the template when Claude invents a number or declines", async () => {
    const p = await buildBriefPayload(prisma, now);
    expect(await writeSummary(p, { client: fakeClient("Ultra will drop to $380 next week.").client })).toMatchObject({ source: "template", note: expect.stringContaining("$380") });
    expect(await writeSummary(p, { client: fakeClient("", "refusal").client })).toMatchObject({ source: "template", note: "model declined" });
    expect(await writeSummary(p, {})).toMatchObject({ source: "template", note: "ANTHROPIC_API_KEY not set" });
  });

  it("waits for the brief time, then builds once a day and emails it", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const deps = { summarize: async () => ({ text: "Short summary.", source: "claude" as const }), email: { apiKey: "re_x", to: "me@example.com", fetchImpl: fetchImpl as unknown as typeof fetch }, baseUrl: "https://rr.test" };
    await prisma.setting.create({ data: { key: "briefTime", value: "09:00" } });
    expect(await briefIfDue(prisma, deps, now)).toBeNull(); // 8:00 < 9:00
    await prisma.setting.update({ where: { key: "briefTime" }, data: { value: "07:00" } });
    const r = await briefIfDue(prisma, deps, now);
    expect(r).toMatchObject({ sentEmail: true, sentPush: false });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ to: ["me@example.com"], subject: expect.stringContaining("to act on") });
    expect(body.html).toContain("https://rr.test/trips/");
    expect(await briefIfDue(prisma, deps, new Date(now.getTime() + 3_600_000))).toBeNull(); // already done today
    const b = await prisma.brief.findFirstOrThrow();
    expect(b).toMatchObject({ summary: "Short summary.", summarySource: "claude", sentEmail: true });
  });

  it("reports the change since yesterday", async () => {
    const li = await prisma.lineItem.findFirstOrThrow({ where: { kind: "flight" } });
    await prisma.lineItem.update({ where: { id: li.id }, data: { quotedAmount: 400 } });
    const r = await runBrief(prisma, { summarize: async () => ({ text: "x", source: "template" as const }) }, { now: new Date("2026-12-02T13:00:00Z"), log: () => {} });
    expect(r!.payload.trips[0]).toMatchObject({ total: 400, change: -27 });
  });
});
