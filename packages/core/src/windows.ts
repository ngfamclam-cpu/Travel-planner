// Spec §3: price the event window, not the route.
import { addDays, diffDays, type ISODate } from "./dates";

export interface TravelWindow {
  arrive: ISODate;
  depart: ISODate;
}

export interface DateVariant extends TravelWindow {
  /** e.g. "base", "-1/+0", "+1/+2" (shift of arrive / shift of depart, in days). */
  label: string;
  outShift: number;
  retShift: number;
}

/** arrive = event start − 1 day, depart = event end + 1 day. */
export function eventWindow(eventStart: ISODate, eventEnd: ISODate): TravelWindow {
  if (eventEnd < eventStart) throw new Error("Event ends before it starts");
  return { arrive: addDays(eventStart, -1), depart: addDays(eventEnd, 1) };
}

export function nights(w: TravelWindow): number {
  return diffDays(w.arrive, w.depart);
}

export function variantLabel(outShift: number, retShift: number): string {
  if (outShift === 0 && retShift === 0) return "base";
  const s = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return `${s(outShift)}/${s(retShift)}`;
}

/**
 * All ±flex date variants around a base window. When the trip is built around an event,
 * pass the event dates so no variant arrives after the first day or leaves before the last.
 * Variants are sorted by how far they move from the base (base first).
 */
export function dateVariants(
  base: TravelWindow,
  flexDays: number,
  event?: { start: ISODate; end: ISODate },
): DateVariant[] {
  const flex = Math.max(0, Math.min(flexDays, 3));
  const out: DateVariant[] = [];
  for (let o = -flex; o <= flex; o++) {
    for (let r = -flex; r <= flex; r++) {
      const arrive = addDays(base.arrive, o);
      const depart = addDays(base.depart, r);
      if (depart <= arrive) continue;
      if (event && (arrive > event.start || depart < event.end)) continue;
      out.push({ arrive, depart, outShift: o, retShift: r, label: variantLabel(o, r) });
    }
  }
  return out.sort(
    (a, b) =>
      Math.abs(a.outShift) + Math.abs(a.retShift) - (Math.abs(b.outShift) + Math.abs(b.retShift)) ||
      a.outShift - b.outShift ||
      a.retShift - b.retShift,
  );
}

/**
 * A "normal week" to compare against for the surge figure: the same trip length,
 * 3 weeks later (or 3 weeks earlier if later is also a known peak).
 */
export function baselineWindow(w: TravelWindow, isPeak: (w: TravelWindow) => boolean): TravelWindow {
  for (const shift of [21, -21, 14, -14, 28]) {
    const cand = { arrive: addDays(w.arrive, shift), depart: addDays(w.depart, shift) };
    if (!isPeak(cand)) return cand;
  }
  return { arrive: addDays(w.arrive, 21), depart: addDays(w.depart, 21) };
}
