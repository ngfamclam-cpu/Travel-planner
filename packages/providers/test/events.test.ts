import { describe, expect, it, vi } from "vitest";
import { fetchEdmtrainFestivals, parseEdmtrain, parseTmDiscovery } from "../src";

const edm = {
  success: true,
  data: [
    { id: 1, link: "https://edmtrain.com/las-vegas-nv/x-1", name: "Neon City", date: "2026-11-20", festivalInd: true, venue: { name: "Downtown LV", location: "Las Vegas, NV", state: "NV", latitude: 36.17, longitude: -115.14 }, artistList: [{ name: "Kaskade" }] },
    { id: 2, link: "https://edmtrain.com/x-2", name: null, date: "2026-11-21", venue: { location: "Brooklyn, NY" }, artistList: [{ name: "Fisher" }, { name: "Chris Lake" }] },
    { id: 3, date: "bad-date", name: "Skip me" },
  ],
};

describe("Edmtrain", () => {
  it("parses events, keeps their link, names artist-only shows", () => {
    const r = parseEdmtrain(edm);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ name: "Neon City", city: "Las Vegas", state: "NV", url: "https://edmtrain.com/las-vegas-nv/x-1", festival: true, lat: 36.17 });
    expect(r[1]).toMatchObject({ name: "Fisher, Chris Lake", city: "Brooklyn", festival: false });
  });
  it("sends festival filter and dates, and surfaces API errors", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(edm)));
    await fetchEdmtrainFestivals("k", { from: "2026-10-23", to: "2027-10-23" }, { fetchImpl: f as unknown as typeof fetch, locationIds: "70,71" });
    const u = new URL((f.mock.calls[0] as unknown as [string])[0]);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ client: "k", festivalInd: "true", startDate: "2026-10-23", locationIds: "70,71" });
    expect(() => parseEdmtrain({ success: false, message: "Invalid client key" })).toThrow("Invalid client key");
  });
});

describe("Ticketmaster discovery", () => {
  it("parses events with venue and attractions", () => {
    const r = parseTmDiscovery({ _embedded: { events: [{ id: "G5", name: "Forbidden Kingdom Festival", url: "https://tm/e", dates: { start: { localDate: "2027-04-23" }, end: { localDate: "2027-04-25" } }, _embedded: { venues: [{ name: "Central Florida Fairgrounds", city: { name: "Orlando" }, state: { stateCode: "FL" } }], attractions: [{ name: "Excision" }] } }] } });
    expect(r[0]).toMatchObject({ source: "ticketmaster", city: "Orlando", start: "2027-04-23", end: "2027-04-25", artists: ["Excision"], festival: true });
  });
});
