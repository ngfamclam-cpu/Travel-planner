// Buy-signal engine (spec §7): BUY NOW / WAIT / WATCH per line item, always with a reason.
import { diffDays, type ISODate } from "./dates";
import { SIGNAL_RULES } from "./signals.config";

export type Signal = "BUY_NOW" | "WAIT" | "WATCH" | "DONE";

export interface SignalResult {
  signal: Signal;
  reason: string;
}

export const SIGNAL_LABEL: Record<Signal, string> = { BUY_NOW: "BUY NOW", WAIT: "WAIT", WATCH: "WATCH", DONE: "DONE" };

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export interface FlightSignalInput {
  today: ISODate;
  departure: ISODate;
  international: boolean;
  booked: boolean;
  /** Today's best price for the chosen dates (null = not checked). */
  price: number | null;
  /** Daily lowest prices for the chosen dates over the last 30 days, oldest first (includes today). */
  history: { date: ISODate; price: number }[];
  insight?: "low" | "typical" | "high" | null;
  /** Name of a peak window the trip falls in (NYE, spring break…), if any. */
  peak?: string | null;
}

export function flightSignal(i: FlightSignalInput): SignalResult {
  const r = SIGNAL_RULES.flight;
  if (i.booked) return { signal: "DONE", reason: "Booked" };
  if (i.price == null) return { signal: "WATCH", reason: "No price for these dates yet" };
  const daysOut = diffDays(i.today, i.departure);
  const [spotStart, spotEnd] = i.international ? r.internationalSweetSpot : r.domesticSweetSpot;
  const lastCall = i.international ? r.internationalLastCall : r.domesticLastCall;
  const recent = i.history.filter((h) => diffDays(h.date, i.today) <= r.historyDays);
  const low = recent.length ? Math.min(...recent.map((h) => h.price)) : i.price;
  const enoughHistory = recent.length >= r.minHistoryPoints;
  // "the lowest in 30 days" only once there are 30 days of prices; until then say how long we've tracked.
  const span = recent.length ? diffDays(recent[0].date, i.today) + 1 : 0;
  const lowPhrase = span >= r.historyDays ? `the lowest in ${r.historyDays} days` : `the lowest since tracking started ${span} days ago`;
  const lowRef = span >= r.historyDays ? `the ${r.historyDays}-day low` : `the ${span}-day low`;
  const above = i.price - low;
  const latestStart = spotEnd + (i.peak ? r.peakEarlierDays : 0);
  const inSpot = daysOut >= spotStart && daysOut <= latestStart;
  const margin = i.peak ? r.peakNearLowPct : r.nearLowPct;

  if (daysOut < lastCall) return { signal: "BUY_NOW", reason: `${daysOut} days out: fares only rise from here (${usd(i.price)})` };
  if (i.insight === "low") return { signal: "BUY_NOW", reason: `Google says prices are low right now (${usd(i.price)})` };
  if (enoughHistory && i.price <= low) return { signal: "BUY_NOW", reason: `${usd(i.price)} is ${lowPhrase}` };
  if (inSpot && enoughHistory && above <= low * margin) {
    return {
      signal: "BUY_NOW",
      reason: i.peak
        ? `${i.peak}: buy early. ${usd(i.price)} is within ${usd(above)} of ${lowRef}`
        : `In the ${spotStart}–${spotEnd} day sweet spot and within ${usd(above)} of ${lowRef}`,
    };
  }
  if (daysOut > latestStart && i.insight === "high") {
    return { signal: "WAIT", reason: `Google says high (${usd(i.price)}); the best window starts in ${daysOut - latestStart} days` };
  }
  if (daysOut > latestStart) return { signal: "WATCH", reason: `${daysOut} days out; the best window starts in ${daysOut - latestStart} days` };
  return {
    signal: "WATCH",
    reason: enoughHistory ? `In the sweet spot; ${usd(above)} above ${lowRef} (${usd(low)})` : `In the sweet spot; building price history (${recent.length} day${recent.length === 1 ? "" : "s"} so far)`,
  };
}

export interface HotelSignalInput {
  booked: boolean;
  bookedRefundable: boolean;
  /** Best refundable price per night for the chosen nights. */
  pricePerNight: number | null;
  hotelName?: string | null;
}

/** Spec §7: always book a refundable rate early, then let rebook alerts find cheaper. */
export function hotelSignal(i: HotelSignalInput): SignalResult {
  if (i.booked) {
    return i.bookedRefundable
      ? { signal: "WATCH", reason: "Booked refundable: re-checked daily, you'll get a rebook alert if it drops" }
      : { signal: "DONE", reason: "Booked (non-refundable)" };
  }
  if (i.pricePerNight == null) return { signal: "WATCH", reason: "No refundable rate found for these nights yet" };
  return {
    signal: "BUY_NOW",
    reason: `Book a free-cancellation rate now (${i.hotelName ? `${i.hotelName}, ` : ""}${usd(i.pricePerNight)}/night); rebook alerts catch drops`,
  };
}

export interface TicketSignalInput {
  booked: boolean;
  /** Cheapest face-value tier currently on sale. */
  face: { label: string; price: number } | null;
  /** Lowest resale price (all-in), if known. */
  resaleFloor: number | null;
  /** Official tiers exist but are all sold out. */
  faceSoldOut: boolean;
}

export function ticketSignal(i: TicketSignalInput): SignalResult {
  const r = SIGNAL_RULES.ticket;
  if (i.booked) return { signal: "DONE", reason: "Bought" };
  if (i.face) {
    if (r.lastTierPattern.test(i.face.label)) return { signal: "BUY_NOW", reason: `${i.face.label} at ${usd(i.face.price)}: no cheaper tier left` };
    if (i.resaleFloor != null && i.resaleFloor > i.face.price) {
      return { signal: "BUY_NOW", reason: `Face value ${usd(i.face.price)}, resale already ${usd(i.resaleFloor)}+` };
    }
    return { signal: "WATCH", reason: `Face value on sale at ${usd(i.face.price)}${i.resaleFloor != null ? `; resale from ${usd(i.resaleFloor)}` : ""}` };
  }
  if (i.faceSoldOut) {
    return { signal: "WATCH", reason: `Face value sold out: join the waitlist and buy the next tier when it opens${i.resaleFloor != null ? ` (resale from ${usd(i.resaleFloor)})` : ""}` };
  }
  if (i.resaleFloor != null) return { signal: "WATCH", reason: `Only resale so far, from ${usd(i.resaleFloor)}` };
  return { signal: "WATCH", reason: "No ticket prices yet" };
}
