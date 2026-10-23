// Step 6: daily BUY NOW / WAIT / WATCH for every flight, hotel and ticket (spec §7).
// Runs after the price jobs; stores the signal + reason on the line item and alerts when a planned
// trip's item flips to BUY NOW.
import {
  addDays,
  destinationFromAirports,
  flightSignal,
  hotelSignal,
  seasonalTraps,
  SIGNAL_LABEL,
  ticketSignal,
  TICKET_PLATFORMS,
  todayIn,
  toISODate,
  type FlightSearchSpec,
  type HotelBooking,
  type Signal,
  type SignalResult,
  type TicketPlatformId,
} from "@rave-run/core";
import { day, type PrismaClient } from "@rave-run/db";

const FRESH_MS = 48 * 3_600_000;

export async function runSignals(prisma: PrismaClient, opts: { now?: Date; log?: (m: string) => void } = {}) {
  const now = opts.now ?? new Date();
  const log = opts.log ?? console.log;
  const today = todayIn("America/New_York", now);
  const fresh = (d: Date | null | undefined) => !!d && now.getTime() - d.getTime() <= FRESH_MS;

  const trips = await prisma.trip.findMany({
    where: { status: { in: ["considering", "planned", "booked"] }, departDate: { gte: day(today) } },
    include: {
      event: { include: { ticketTiers: true, ticketWatches: true, ticketPrices: { where: { observedAt: { gte: new Date(now.getTime() - FRESH_MS) } } } } },
      lineItems: { where: { kind: { in: ["flight", "hotel", "ticket"] } } },
    },
  });

  let updated = 0;
  let alerts = 0;
  for (const trip of trips) {
    const arrive = toISODate(trip.arriveDate);
    const depart = toISODate(trip.departDate);
    for (const li of trip.lineItems) {
      let result: SignalResult;
      if (!li.included) {
        result = { signal: "DONE", reason: "Not counted (switched off)" };
      } else if (li.kind === "flight") {
        const spec = li.searchSpec as FlightSearchSpec | null;
        const dest = trip.event ? { country: trip.event.country, city: trip.event.city, airports: spec?.destinations ?? [] } : destinationFromAirports(spec?.destinations ?? []);
        const snaps = await prisma.priceSnapshot.findMany({
          where: { lineItemId: li.id, isBaseline: false, outboundDate: day(arrive), returnDate: day(depart), fetchedAt: { gte: day(addDays(today, -31)) } },
          orderBy: { fetchedAt: "asc" },
        });
        const byDay = new Map<string, number>();
        for (const s of snaps) {
          const d = toISODate(s.fetchedAt);
          byDay.set(d, Math.min(byDay.get(d) ?? Infinity, Number(s.totalPrice)));
        }
        const latest = snaps.at(-1);
        const price = latest && fresh(latest.fetchedAt) ? Math.min(...snaps.filter((s) => fresh(s.fetchedAt)).map((s) => Number(s.totalPrice))) : null;
        result = flightSignal({
          today,
          departure: arrive,
          international: dest.country !== "US",
          booked: li.bookedAmount != null,
          price,
          history: [...byDay.entries()].map(([date, p]) => ({ date, price: p })),
          insight: (latest?.insightLabel as "low" | "typical" | "high" | null) ?? null,
          peak: seasonalTraps({ start: arrive, end: depart }, dest)[0]?.name ?? null,
        });
      } else if (li.kind === "hotel") {
        const booking = (li.booking ?? {}) as HotelBooking;
        result = hotelSignal({
          booked: li.bookedAmount != null,
          bookedRefundable: !!booking.refundable,
          pricePerNight: li.quotedAmount != null && fresh(li.quotedAt) ? Number(li.quotedAmount) : null,
          hotelName: li.quotedSource?.match(/\((?:[^:]+: )?([^,]+),/)?.[1] ?? null,
        });
      } else {
        const ev = trip.event;
        const tiers = ev?.ticketTiers ?? [];
        const official = (ev?.ticketPrices ?? []).filter((p) => TICKET_PLATFORMS[p.platform as TicketPlatformId]?.kind === "official");
        const resale = (ev?.ticketPrices ?? []).filter((p) => !p.risky && TICKET_PLATFORMS[p.platform as TicketPlatformId]?.kind !== "official");
        const faceOptions = [
          ...tiers.filter((t) => !t.isResale && t.onSale && !t.soldOut && t.priceAllIn != null).map((t) => ({ label: t.tierLabel ? `${t.name} (${t.tierLabel})` : t.name, price: Number(t.priceAllIn) })),
          ...official.map((p) => ({ label: `${TICKET_PLATFORMS[p.platform as TicketPlatformId].name} ${p.tierLabel ?? "face value"}`, price: Number(p.allInPrice) })),
        ].sort((a, b) => a.price - b.price);
        const resaleFloor = [
          ...tiers.filter((t) => t.isResale && t.priceAllIn != null && now.getTime() - t.observedAt.getTime() <= FRESH_MS).map((t) => Number(t.priceAllIn)),
          ...resale.map((p) => Number(p.allInPrice)),
        ].sort((a, b) => a - b)[0] ?? null;
        const officialStates = (ev?.ticketWatches ?? []).map((w) => w.officialState).filter(Boolean);
        const faceTiers = tiers.filter((t) => !t.isResale);
        result = ticketSignal({
          booked: li.bookedAmount != null,
          face: faceOptions[0] ?? null,
          resaleFloor,
          faceSoldOut: (faceTiers.length > 0 && faceTiers.every((t) => t.soldOut)) || officialStates.some((s) => s === "soldout" || s === "offsale"),
        });
      }

      const changed = li.signal !== result.signal;
      await prisma.lineItem.update({
        where: { id: li.id },
        data: { signal: result.signal, signalReason: result.reason, signalAt: now, ...(changed ? { signalChangedAt: now } : {}) },
      });
      updated++;

      // Alert when a planned/booked trip's item becomes BUY NOW.
      if (changed && result.signal === "BUY_NOW" && (trip.status === "planned" || trip.status === "booked")) {
        const key = `buy_now:${li.id}:${today}`;
        if (!(await prisma.alert.findUnique({ where: { dedupeKey: key } }))) {
          await prisma.alert.updateMany({ where: { lineItemId: li.id, kind: "buy_now", dismissedAt: null }, data: { dismissedAt: now } });
          await prisma.alert.create({
            data: {
              lineItemId: li.id,
              tripId: trip.id,
              kind: "buy_now",
              title: `${trip.name}: ${SIGNAL_LABEL.BUY_NOW} ${li.kind} (${li.label})`,
              body: result.reason,
              url: li.quotedUrl,
              dedupeKey: key,
            },
          });
          alerts++;
        }
      }
    }
  }
  log(`Signals: ${updated} items, ${alerts} new BUY NOW alerts`);
  return { updated, alerts };
}

export type { Signal };
