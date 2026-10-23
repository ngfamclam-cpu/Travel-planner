// Step 9: arrival guides for planned/booked trips, refreshed weekly (or when asked from the trip page).
import { survivalNotes, templateGuide, toISODate, type ArrivalGuideContent, type GuideContext, type HotelSearchSpec, type Place } from "@rave-run/core";
import type { Prisma, PrismaClient } from "@rave-run/db";
import { finishDraft, type GuideWriter } from "../guides/claude";

export interface GuideDeps {
  geocode: (q: string) => Promise<{ lat: number; lng: number; label: string } | null>;
  places: (lat: number, lng: number) => Promise<Place[]>;
  placesSource: string;
  writer: GuideWriter | null;
  pauseMs?: number;
}

const WEEK_MS = 7 * 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runGuides(prisma: PrismaClient, deps: GuideDeps, opts: { now?: Date; onlyRequested?: boolean; log?: (m: string) => void } = {}) {
  const now = opts.now ?? new Date();
  const log = opts.log ?? console.log;
  const trips = await prisma.trip.findMany({
    where: {
      departDate: { gte: now },
      OR: [{ status: { in: ["planned", "booked"] } }, { guide: { status: "requested" } }],
    },
    include: { event: true, guide: true, lineItems: true },
  });
  const due = trips.filter((t) => {
    const g = t.guide;
    if (g?.requestedAt && (!g.generatedAt || g.requestedAt > g.generatedAt)) return true;
    if (opts.onlyRequested) return false;
    return !g?.generatedAt || now.getTime() - g.generatedAt.getTime() >= WEEK_MS;
  });

  let built = 0;
  for (const [i, t] of due.entries()) {
    const ev = t.event;
    const hotel = t.lineItems.find((l) => l.kind === "hotel");
    const hotelArea = ((hotel?.searchSpec ?? {}) as HotelSearchSpec).query ?? null;
    const city = ev?.city ?? hotelArea?.replace(/^hotels (in|near|on( the)?) /i, "") ?? t.name;
    const ctx: GuideContext = {
      tripName: t.name,
      venue: ev?.venue ?? null,
      city,
      country: ev?.country ?? "US",
      eventStart: ev ? toISODate(ev.startDate) : null,
      eventEnd: ev ? toISODate(ev.endDate) : null,
      arrive: toISODate(t.arriveDate),
      depart: toISODate(t.departDate),
      indoor: /indoor/i.test(`${ev?.notes ?? ""} ${ev?.venue ?? ""}`) || /convention center/i.test(ev?.venue ?? ""),
      groundItems: t.lineItems.filter((l) => l.kind === "ground").map((l) => l.label),
      hotelArea,
    };
    const save = (data: Partial<Prisma.ArrivalGuideUncheckedCreateInput>) =>
      prisma.arrivalGuide.upsert({ where: { tripId: t.id }, create: { tripId: t.id, ...data }, update: data });
    try {
      // Where: the venue's coordinates (saved on the event), else the city.
      let where: ArrivalGuideContent["where"] | null = ev?.lat != null && ev.lng != null ? { label: `${ev.venue ?? ev.city}, ${ev.city}`, lat: ev.lat, lng: ev.lng } : null;
      if (!where) {
        const q = ctx.venue && ctx.venue !== "TBA" ? `${ctx.venue}, ${ctx.city}` : ctx.city;
        const g = (await deps.geocode(q)) ?? (q !== ctx.city ? await deps.geocode(ctx.city) : null);
        if (!g) throw new Error(`couldn't find "${q}" on the map`);
        where = { label: q, lat: g.lat, lng: g.lng };
        if (ev) await prisma.event.update({ where: { id: ev.id }, data: { lat: g.lat, lng: g.lng } });
      }
      const places = await deps.places(where.lat, where.lng);
      if (!places.some((p) => p.kind === "food")) throw new Error(`no restaurants found near ${where.label} (${deps.placesSource})`);

      let content = templateGuide(ctx, where, places, deps.placesSource);
      if (deps.writer) {
        const r = await deps.writer(ctx, places);
        const finished = "draft" in r ? finishDraft(r.draft, places) : null;
        if (finished) content = { ...content, ...finished, gettingThere: finished.gettingThere.length ? finished.gettingThere : content.gettingThere, survival: survivalNotes(ctx), writtenBy: "claude" };
        else content.note = "error" in r ? `Claude not used: ${r.error}` : "Claude's picks didn't match enough real places; showing the plain guide";
      } else {
        content.note = "Plain guide (add ANTHROPIC_API_KEY for written picks)";
      }
      await save({ content: content as unknown as Prisma.InputJsonValue, places: places as unknown as Prisma.InputJsonValue, status: "ok", error: null, generatedAt: now });
      await prisma.providerRun.create({ data: { provider: deps.placesSource, kind: "places", ok: true, queries: 1, results: places.length } });
      built++;
    } catch (e) {
      const msg = (e as Error).message;
      await save({ status: "error", error: msg, generatedAt: now });
      await prisma.providerRun.create({ data: { provider: deps.placesSource, kind: "places", ok: false, queries: 1, error: `${t.name}: ${msg}` } });
    }
    if (deps.pauseMs && i < due.length - 1) await sleep(deps.pauseMs);
  }
  log(`Guides: ${built}/${due.length} built`);
  return { due: due.length, built };
}
