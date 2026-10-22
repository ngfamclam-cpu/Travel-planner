// Date-clash detection between trips (spec §2.6, §14).
import { gapDays, rangesOverlap, type DateRange } from "./dates";

export interface TripLike {
  id: string;
  name: string;
  status: "considering" | "planned" | "booked" | "done";
  arrive: string;
  depart: string;
  /** Trips in the same compare slot are alternatives, so they never clash with each other. */
  slot?: string | null;
}

export interface Clash {
  tripId: string;
  otherId: string;
  otherName: string;
  kind: "overlap" | "tight";
  /** Days between trips (negative for overlap). */
  gap: number;
  message: string;
}

const ACTIVE = new Set(["considering", "planned", "booked"]);

/** Clashes for one trip against the others: overlapping dates, or under 2 days at home between trips. */
export function findClashes(trip: TripLike, others: TripLike[], minGapDays = 2): Clash[] {
  if (!ACTIVE.has(trip.status)) return [];
  const a: DateRange = { start: trip.arrive, end: trip.depart };
  const out: Clash[] = [];
  for (const o of others) {
    if (o.id === trip.id || !ACTIVE.has(o.status)) continue;
    if (trip.slot && trip.slot === o.slot) continue;
    const b: DateRange = { start: o.arrive, end: o.depart };
    if (rangesOverlap(a, b)) {
      out.push({
        tripId: trip.id,
        otherId: o.id,
        otherName: o.name,
        kind: "overlap",
        gap: gapDays(a, b),
        message: `Dates overlap with ${o.name}`,
      });
    } else {
      const gap = gapDays(a, b);
      if (gap < minGapDays) {
        out.push({
          tripId: trip.id,
          otherId: o.id,
          otherName: o.name,
          kind: "tight",
          gap,
          message: `Only ${gap} day${gap === 1 ? "" : "s"} between this and ${o.name}`,
        });
      }
    }
  }
  return out;
}

/** Does an event (e.g. from discovery) clash with any planned or booked trip? */
export function eventClashes(event: DateRange, trips: TripLike[]): TripLike[] {
  return trips.filter(
    (t) => (t.status === "planned" || t.status === "booked") && rangesOverlap(event, { start: t.arrive, end: t.depart }),
  );
}
