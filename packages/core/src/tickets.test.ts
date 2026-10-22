import { describe, expect, it } from "vitest";
import { allInPrice, defaultTicketPlatforms, isNycArea, lowestTicket, ticketAlerts, type TicketQuote } from "./index";

const now = new Date("2026-10-22T12:00:00Z");
const q = (platform: TicketQuote["platform"], allIn: number, extra: Partial<TicketQuote> = {}): TicketQuote => ({
  platform, allIn, listed: allIn, feesEstimated: false, observedAt: now, source: "page", risky: platform === "radiate", ...extra,
});

describe("ticket platforms", () => {
  it("adds CrowdVolt only for NYC-area events; Asia gets Radiate only", () => {
    expect(isNycArea("Brooklyn")).toBe(true);
    expect(defaultTicketPlatforms({ city: "Brooklyn" })).toContain("crowdvolt");
    expect(defaultTicketPlatforms({ city: "Miami" })).not.toContain("crowdvolt");
    expect(defaultTicketPlatforms({ city: "Tokyo", region: "Asia" })).toEqual(["radiate"]);
  });
  it("estimates fees only when the site's price excludes them", () => {
    expect(allInPrice(400, false, 25)).toEqual({ allIn: 500, feesEstimated: true });
    expect(allInPrice(85, true, 25)).toEqual({ allIn: 85, feesEstimated: false });
  });
});

describe("lowestTicket", () => {
  it("never counts Radiate and ignores stale prices", () => {
    const low = lowestTicket([q("radiate", 100), q("vividseats", 300, { observedAt: new Date("2026-10-19T00:00:00Z") }), q("seatgeek", 350), q("stubhub", 360)], now);
    expect(low?.platform).toBe("seatgeek");
  });
});

describe("ticketAlerts", () => {
  const base = { eventId: "e1", eventName: "Ultra", target: null, current: [], previousLowest: null, statusChanges: [], crowdvoltGap: 20 };

  it("fires below target, using the cheapest non-Radiate price", () => {
    const a = ticketAlerts({ ...base, target: 450, current: [q("radiate", 200), q("vividseats", 440, { feesEstimated: true }), q("seatgeek", 470)] }, now);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "ticket_target", platform: "vividseats", amount: 10 });
    expect(a[0].body).toContain("fees estimated");
  });
  it("fires on a meaningful new low anywhere ($15 / 5%)", () => {
    expect(ticketAlerts({ ...base, previousLowest: 500, current: [q("stubhub", 470)] }, now)[0]).toMatchObject({ kind: "ticket_drop", amount: 30 });
    expect(ticketAlerts({ ...base, previousLowest: 500, current: [q("stubhub", 490)] }, now)).toHaveLength(0);
  });
  it("fires when face value comes back on sale or sells out, not on first sight", () => {
    const back = ticketAlerts({ ...base, statusChanges: [{ platform: "ticketmaster", from: "offsale", to: "onsale" }] }, now);
    expect(back[0].kind).toBe("ticket_onsale");
    expect(ticketAlerts({ ...base, statusChanges: [{ platform: "dice", from: "onsale", to: "soldout" }] }, now)[0].kind).toBe("ticket_soldout");
    expect(ticketAlerts({ ...base, statusChanges: [{ platform: "ticketmaster", from: null, to: "onsale" }] }, now)).toHaveLength(0);
  });
  it("fires when CrowdVolt's ask is close to the bid", () => {
    const a = ticketAlerts({ ...base, current: [q("crowdvolt", 195, { listed: 185, highestBid: 170 })] }, now);
    expect(a[0]).toMatchObject({ kind: "crowdvolt_gap", amount: 15 });
    expect(ticketAlerts({ ...base, current: [q("crowdvolt", 220, { listed: 210, highestBid: 150 })] }, now)).toHaveLength(0);
  });
  it("Radiate never alerts", () => {
    expect(ticketAlerts({ ...base, target: 500, previousLowest: 600, current: [q("radiate", 100)] }, now)).toHaveLength(0);
  });
});
