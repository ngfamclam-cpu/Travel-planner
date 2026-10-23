import { describe, expect, it } from "vitest";
import { inventedNumbers, pushText, renderBriefHtml, renderBriefText, templateSummary, type BriefPayload } from "./index";

const p: BriefPayload = {
  date: "2026-12-01",
  dateLabel: "Tue, Dec 1",
  counts: { actions: 2, plannedTrips: 1, buyNow: 2, newEvents: 1, problems: 1 },
  actions: [
    { kind: "buy_now", title: "Ultra Miami: BUY NOW flight", detail: "$410 is the lowest since tracking started 7 days ago", url: null },
    { kind: "rebook", title: "Ultra Miami: rebook and save $220", detail: "DEMO Bayside", url: null },
  ],
  trips: [
    {
      name: "Ultra Miami", status: "planned", dates: "Mar 25 – Mar 29, 2027", daysAway: 114, total: 2321, change: -40, notPriced: 1, buyNow: 2, url: "/trips/u",
      items: [
        { kind: "flight", label: "Flight BOS → MIA", amount: 410, state: "quoted", signal: "BUY_NOW", reason: "lowest", card: "Amex Gold: 3x", lastChecked: null },
        { kind: "ticket", label: "GA (resale)", amount: 517, state: "quoted", signal: "WATCH", reason: null, card: null, lastChecked: "Sep 2026" },
      ],
    },
  ],
  considering: [{ group: "NYE 2026", options: 8, cheapest: { name: "HiJinx NYE", total: 1115 } }],
  newEvents: [{ name: "Bass Fest", city: "Austin", dates: "Jun 18–20, 2027", artists: ["Subtronics"], clashesWith: [], url: null }],
  problems: [{ source: "Hotel prices", note: "SERPAPI_KEY not set" }],
  savings: null,
};

describe("brief number check", () => {
  it("accepts prose that only repeats payload numbers", () => {
    expect(inventedNumbers("Ultra Miami is $2,321, down $40. Buy the $410 flight; 2 things to do, 8 NYE options, 114 days away.", p)).toEqual([]);
  });
  it("catches invented or computed numbers", () => {
    expect(inventedNumbers("Ultra is $2,400 and you'd save $107 by waiting 11 weeks.", p)).toEqual(["$2,400", "$107", "11"]);
  });
});

describe("brief rendering", () => {
  it("builds a template summary, text, html and push from the same facts", () => {
    const s = templateSummary(p);
    expect(s).toContain("2 things to act on today");
    expect(s).toContain("Ultra Miami is $2,321 (−$40 since yesterday), 2 to buy now.");
    expect(inventedNumbers(s, p)).toEqual([]);
    const txt = renderBriefText(p, s, "https://x");
    expect(txt).toContain("ULTRA MIAMI: $2,321 (−$40 vs yesterday)");
    expect(txt).toContain("(last checked Sep 2026)");
    expect(txt).toContain("COULDN'T CHECK");
    expect(renderBriefHtml(p, s)).toContain("<b style=\"color:#15803d\">BUY NOW</b>");
    expect(pushText(p)).toEqual({ title: "Rave Run · Tue, Dec 1", body: "2 to act on · Ultra Miami $2,321 (−$40) · 1 new events" });
  });
});
