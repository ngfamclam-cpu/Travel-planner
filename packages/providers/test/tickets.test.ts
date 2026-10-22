import { describe, expect, it, vi } from "vitest";
import { extractPagePrice, looksLikeEventPage, PageChecker, parseSgEvent, parseTmEvent, robotsAllows, TicketmasterChecker, ticketCheckers } from "../src";

const vivid = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"MusicEvent","name":"Ultra Music Festival",
"offers":{"@type":"AggregateOffer","lowPrice":"489.00","highPrice":"2400","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script>
</head><body>…</body></html>`;

const dice = `<script type="application/ld+json">[{"@type":"Event","name":"Club NYE","offers":[
{"@type":"Offer","name":"Final release","price":85,"priceCurrency":"USD","availability":"InStock"},
{"@type":"Offer","name":"Early bird","price":55,"availability":"SoldOut"}]}]</script>`;

const crowdvolt = `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"event":{"name":"Time Warp NYC",
"tickets":[{"type":"GA Fri","lowestAskCents":18500,"highestBidCents":16000},{"type":"GA Sat","lowestAskCents":21000,"highestBidCents":15000}]}}}}</script>`;

describe("page price extraction", () => {
  it("reads schema.org AggregateOffer (Vivid Seats / StubHub style)", () => {
    expect(extractPagePrice(vivid)).toMatchObject({ low: 489, availability: "onsale", currency: "USD", via: "json-ld" });
  });
  it("takes the cheapest priced offer and keeps its tier name", () => {
    expect(extractPagePrice(dice)).toMatchObject({ low: 55, tierLabel: "Early bird" });
  });
  it("reads ask/bid from embedded app data, converting cents", () => {
    expect(extractPagePrice(crowdvolt)).toMatchObject({ low: 185, highestBid: 160, via: "app-data" });
  });
  it("returns nothing when there is no price", () => {
    expect(extractPagePrice("<html><body>Sold out</body></html>").low).toBeNull();
  });
});

describe("robots.txt", () => {
  const robots = "User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /checkout\nDisallow: /api/\nAllow: /api/public\n";
  it("applies only the * group, longest rule wins", () => {
    expect(robotsAllows(robots, "/event/ultra-123")).toBe(true);
    expect(robotsAllows(robots, "/checkout/x")).toBe(false);
    expect(robotsAllows(robots, "/api/private")).toBe(false);
    expect(robotsAllows(robots, "/api/public/1")).toBe(true);
  });
});

describe("PageChecker", () => {
  const respond = (pages: Record<string, Response>) =>
    vi.fn(async (url: string, _init?: RequestInit) => pages[new URL(url).pathname] ?? new Response("", { status: 404 }));

  it("returns the listed price and whether fees are included", async () => {
    const f = respond({ "/robots.txt": new Response("User-agent: *\nDisallow: /checkout"), "/ultra": new Response(vivid) });
    const c = new PageChecker("vividseats", { listedIncludesFees: false, fetchImpl: f as unknown as typeof fetch });
    expect(await c.check({ url: "https://www.vividseats.com/ultra" })).toMatchObject({ ok: true, listed: 489, feesIncluded: false, status: "onsale" });
    expect(f.mock.calls[1][1]?.headers).toMatchObject({ "user-agent": expect.stringContaining("RaveRun") });
  });

  it("respects robots.txt", async () => {
    const f = respond({ "/robots.txt": new Response("User-agent: *\nDisallow: /") });
    const c = new PageChecker("stubhub", { listedIncludesFees: false, fetchImpl: f as unknown as typeof fetch });
    expect(await c.check({ url: "https://www.stubhub.com/event/1" })).toMatchObject({ ok: false, blocked: true });
    expect(f).toHaveBeenCalledTimes(1); // never fetched the page
  });

  it("reports blocks and missing prices softly", async () => {
    const blocked = respond({ "/e": new Response("<html>Please complete the captcha</html>", { status: 403 }) });
    expect(await new PageChecker("stubhub", { listedIncludesFees: false, fetchImpl: blocked as unknown as typeof fetch }).check({ url: "https://x.com/e" })).toMatchObject({ ok: false, blocked: true });
    const empty = respond({ "/e": new Response("<html>nothing</html>") });
    expect(await new PageChecker("ra", { listedIncludesFees: false, fetchImpl: empty as unknown as typeof fetch }).check({ url: "https://ra.co/e" })).toMatchObject({ ok: false, noPrice: true });
    expect(await new PageChecker("ra", { listedIncludesFees: false }).check({ url: null })).toMatchObject({ ok: false, noPrice: true });
  });
});

describe("official APIs", () => {
  it("parses Ticketmaster face value and status", () => {
    const r = parseTmEvent({ id: "G5v", name: "X", url: "https://tm/x", dates: { status: { code: "onsale" } }, priceRanges: [{ min: 199.5, max: 400 }, { min: 150, max: 150 }] });
    expect(r).toMatchObject({ ok: true, listed: 150, feesIncluded: false, status: "onsale", tierLabel: "face value" });
    expect(parseTmEvent({ id: "1", name: "X", dates: { status: { code: "offsale" } } })).toMatchObject({ ok: false, noPrice: true, status: "offsale" });
  });
  it("parses SeatGeek lowest price", () => {
    expect(parseSgEvent({ id: 9, url: "https://sg/e/9", stats: { lowest_price: 233 } })).toMatchObject({ ok: true, listed: 233 });
    expect(parseSgEvent({ id: 9, stats: { lowest_price: null } })).toMatchObject({ ok: false, noPrice: true });
  });
  it("matches Ticketmaster events by city", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ _embedded: { events: [
      { id: "a", name: "Other", _embedded: { venues: [{ city: { name: "Chicago" } }] } },
      { id: "b", name: "Time Warp", url: "https://tm/b", _embedded: { venues: [{ city: { name: "Brooklyn" } }] } },
    ] } })));
    const tm = new TicketmasterChecker("k", { fetchImpl: f as unknown as typeof fetch });
    expect(await tm.find({ name: "Time Warp", city: "Brooklyn", start: "2026-11-20", end: "2026-11-21" })).toMatchObject({ externalId: "b" });
  });
  it("fails soft without keys; Radiate is manual only", async () => {
    const c = ticketCheckers({});
    expect(await c.ticketmaster.check({ externalId: "x" })).toMatchObject({ ok: false, notConfigured: true });
    expect(await c.radiate.check({})).toMatchObject({ ok: false, noPrice: true });
  });
});

describe("finder", () => {
  it("accepts event pages, rejects search/help pages and other domains", () => {
    expect(looksLikeEventPage("https://www.vividseats.com/ultra-music-festival-tickets-miami-3-26-2027--concerts/production/5555", "vividseats.com")).toBe(true);
    expect(looksLikeEventPage("https://www.vividseats.com/search?searchTerm=ultra", "vividseats.com")).toBe(false);
    expect(looksLikeEventPage("https://www.stubhub.com/", "stubhub.com")).toBe(false);
    expect(looksLikeEventPage("https://evil.com/vividseats.com", "vividseats.com")).toBe(false);
  });
});
