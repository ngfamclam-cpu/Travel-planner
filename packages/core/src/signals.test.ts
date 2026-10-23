import { describe, expect, it } from "vitest";
import { flightSignal, hotelSignal, ticketSignal } from "./index";

const hist = (prices: number[], end = "2026-12-01") =>
  prices.map((price, i) => ({ date: new Date(Date.parse(`${end}T00:00:00Z`) - (prices.length - 1 - i) * 86_400_000).toISOString().slice(0, 10), price }));

describe("flight signals", () => {
  const base = { today: "2026-12-01", international: false, booked: false };
  it("buys at a 30-day low", () => {
    const month = hist(Array.from({ length: 30 }, (_, k) => 480 - k * 2).concat([400]).slice(-30));
    expect(flightSignal({ ...base, departure: "2027-03-25", price: 400, history: month })).toMatchObject({ signal: "BUY_NOW", reason: "$400 is the lowest in 30 days" });
    // A week of data: says so instead of claiming 30 days
    expect(flightSignal({ ...base, departure: "2027-03-25", price: 400, history: hist([470, 460, 450, 440, 430, 420, 400]) }).reason).toBe("$400 is the lowest since tracking started 7 days ago");
    // Under a week: not enough to call it
    expect(flightSignal({ ...base, departure: "2027-03-25", price: 400, history: hist([450, 430, 400]) }).signal).not.toBe("BUY_NOW");
  });
  it("buys inside the sweet spot when near the low", () => {
    const r = flightSignal({ ...base, departure: "2027-01-20", price: 410, history: hist([430, 440, 400, 430, 440, 420, 410]) });
    expect(r).toMatchObject({ signal: "BUY_NOW", reason: expect.stringContaining("sweet spot") });
  });
  it("waits when Google says high and it's early", () => {
    expect(flightSignal({ ...base, departure: "2027-05-13", price: 520, history: hist([480, 500, 520]), insight: "high" }).signal).toBe("WAIT");
  });
  it("buys when the last call has passed", () => {
    expect(flightSignal({ ...base, departure: "2026-12-15", price: 600, history: [] }).signal).toBe("BUY_NOW");
    expect(flightSignal({ ...base, international: true, departure: "2027-01-10", price: 1500, history: [] }).signal).toBe("BUY_NOW"); // 40 < 45
  });
  it("starts the window earlier for peak weeks", () => {
    // 110 days out: outside 21–90 normally, inside with the 30-day peak bias
    const args = { ...base, departure: "2027-03-21", price: 415, history: hist([430, 440, 400, 430, 440, 420, 415]) };
    expect(flightSignal(args).signal).toBe("WATCH");
    expect(flightSignal({ ...args, peak: "Florida spring break" })).toMatchObject({ signal: "BUY_NOW", reason: expect.stringContaining("Florida spring break") });
  });
  it("watches with no price or thin history, done when booked", () => {
    expect(flightSignal({ ...base, departure: "2027-01-20", price: null, history: [] }).signal).toBe("WATCH");
    expect(flightSignal({ ...base, departure: "2027-01-20", price: 500, history: hist([500]) }).reason).toContain("building price history");
    expect(flightSignal({ ...base, booked: true, departure: "2027-01-20", price: 1, history: [] }).signal).toBe("DONE");
  });
});

describe("hotel signals", () => {
  it("books refundable early, then watches", () => {
    expect(hotelSignal({ booked: false, bookedRefundable: false, pricePerNight: 290, hotelName: "X" })).toMatchObject({ signal: "BUY_NOW" });
    expect(hotelSignal({ booked: true, bookedRefundable: true, pricePerNight: 290 }).signal).toBe("WATCH");
    expect(hotelSignal({ booked: true, bookedRefundable: false, pricePerNight: 290 }).signal).toBe("DONE");
  });
});

describe("ticket signals", () => {
  it("buys face value when resale is already higher (spec example)", () => {
    expect(ticketSignal({ booked: false, face: { label: "2-day GA", price: 215 }, resaleFloor: 282, faceSoldOut: false })).toMatchObject({ signal: "BUY_NOW", reason: "Face value $215, resale already $282+" });
  });
  it("buys the last tier", () => {
    expect(ticketSignal({ booked: false, face: { label: "Tier 4 (last tier)", price: 383.64 }, resaleFloor: null, faceSoldOut: false }).signal).toBe("BUY_NOW");
  });
  it("watches sold-out face value (Ultra) with the resale floor", () => {
    expect(ticketSignal({ booked: false, face: null, resaleFloor: 517, faceSoldOut: true })).toMatchObject({ signal: "WATCH", reason: expect.stringContaining("waitlist") });
  });
});
