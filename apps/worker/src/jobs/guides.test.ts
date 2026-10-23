// Integration test: needs TEST_DATABASE_URL pointing at a migrated, disposable database.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { PrismaClient, createTripFromEvent, day } from "@rave-run/db";
import type { ArrivalGuideContent, Place } from "@rave-run/core";
import { runGuides } from "./guides";
import { claudeGuideWriter } from "../guides/claude";

const url = process.env.TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : (null as unknown as PrismaClient);

const places: Place[] = [
  { id: "osm:node/1", name: "Versailles", kind: "food", cuisine: "cuban" },
  { id: "osm:node/2", name: "La Sandwicherie", kind: "food", lateNight: true },
  { id: "osm:node/3", name: "Garcia's", kind: "food", cuisine: "seafood" },
  { id: "osm:node/4", name: "Pérez Art Museum", kind: "sight" },
];

describe.skipIf(!url)("arrival guides", () => {
  let tripId = "";
  beforeAll(async () => {
    for (const t of ["arrivalGuide", "alert", "priceSnapshot", "lineItem", "trip", "event", "providerRun"] as const) {
      await (prisma[t] as unknown as { deleteMany: () => Promise<unknown> }).deleteMany();
    }
    const ev = await prisma.event.create({ data: { name: "Ultra Guide", city: "Miami", venue: "Bayfront Park", startDate: day("2027-03-26"), endDate: day("2027-03-28"), airports: ["MIA"], genres: [], lineupHighlights: [] } });
    tripId = (await createTripFromEvent(prisma, ev.id, { status: "planned" })).id;
  });
  afterAll(() => prisma.$disconnect());

  it("builds a Claude guide from real places only, geocoding the venue once", async () => {
    const draft = {
      neighborhoods: [{ name: "Brickell", why: "Walkable to the venue" }],
      food: [
        { placeId: "osm:node/1", why: "The Cuban classic" },
        { placeId: "osm:node/2", why: "Open late for after the show" },
        { placeId: "osm:node/999", why: "A place Claude made up" },
        { placeId: "osm:node/3", why: "Fresh seafood on the river; mains around $30" },
      ],
      todo: [{ placeId: "osm:node/4", why: "Bayfront art museum" }],
      gettingThere: ["Metromover is free and stops near the park."],
    };
    const create = vi.fn(async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(draft) }] }));
    const geocode = vi.fn(async () => ({ lat: 25.7753, lng: -80.1862, label: "Bayfront Park" }));
    const r = await runGuides(
      prisma,
      { geocode, places: async () => places, placesSource: "OpenStreetMap", writer: claudeGuideWriter({ client: { beta: { messages: { create } } } as unknown as Anthropic }) },
      { now: new Date("2026-12-01T12:00:00Z"), log: () => {} },
    );
    expect(r).toEqual({ due: 1, built: 1 });
    const g = await prisma.arrivalGuide.findUniqueOrThrow({ where: { tripId } });
    const c = g.content as unknown as ArrivalGuideContent;
    expect(c.writtenBy).toBe("claude");
    expect(c.food.map((f) => f.name)).toEqual(["Versailles", "La Sandwicherie"]); // made-up place and the one with a price dropped
    expect(c.todo[0].name).toBe("Pérez Art Museum");
    expect(c.survival.join(" ")).toContain("earplugs");
    expect((await prisma.event.findFirstOrThrow()).lat).toBe(25.7753);
    const args = (create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(args).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "low", format: { type: "json_schema" } } });

    // Fresh guide: not rebuilt until a week passes or it's requested
    expect((await runGuides(prisma, { geocode, places: async () => places, placesSource: "x", writer: null }, { now: new Date("2026-12-03T12:00:00Z"), log: () => {} })).due).toBe(0);
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it("falls back to the plain guide when Claude's picks don't hold up, and on request", async () => {
    await prisma.arrivalGuide.update({ where: { tripId }, data: { requestedAt: new Date("2026-12-04T00:00:00Z") } });
    const bad = vi.fn(async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ neighborhoods: [], food: [{ placeId: "nope", why: "x" }], todo: [], gettingThere: [] }) }] }));
    const r = await runGuides(
      prisma,
      { geocode: async () => null, places: async () => places, placesSource: "OpenStreetMap", writer: claudeGuideWriter({ client: { beta: { messages: { create: bad } } } as unknown as Anthropic }) },
      { now: new Date("2026-12-04T12:00:00Z"), onlyRequested: true, log: () => {} },
    );
    expect(r.built).toBe(1);
    const c = (await prisma.arrivalGuide.findUniqueOrThrow({ where: { tripId } })).content as unknown as ArrivalGuideContent;
    expect(c).toMatchObject({ writtenBy: "template", note: expect.stringContaining("didn't match") });
    expect(c.food[0].name).toBe("La Sandwicherie"); // late-night first
  });

  it("records an error when the map lookup finds nothing", async () => {
    await prisma.event.updateMany({ data: { lat: null, lng: null } });
    await prisma.arrivalGuide.update({ where: { tripId }, data: { requestedAt: new Date("2026-12-05T00:00:00Z") } });
    await runGuides(prisma, { geocode: async () => null, places: async () => places, placesSource: "OpenStreetMap", writer: null }, { now: new Date("2026-12-05T12:00:00Z"), onlyRequested: true, log: () => {} });
    expect(await prisma.arrivalGuide.findUniqueOrThrow({ where: { tripId } })).toMatchObject({ status: "error", error: expect.stringContaining("couldn't find") });
  });
});
