import { describe, expect, it, vi } from "vitest";
import { geocode, googlePlaces, overpassQuery, parseOverpass } from "../src";

describe("OpenStreetMap", () => {
  it("parses Overpass elements into places", () => {
    const p = parseOverpass({
      elements: [
        { type: "node", id: 1, lat: 25.77, lon: -80.19, tags: { name: "La Sandwicherie", amenity: "fast_food", cuisine: "sandwich", opening_hours: "Mo-Su 09:00-05:00" } },
        { type: "way", id: 2, center: { lat: 25.78, lon: -80.18 }, tags: { name: "Pérez Art Museum Miami", tourism: "museum", website: "https://pamm.org" } },
        { type: "node", id: 3, lat: 1, lon: 1, tags: { amenity: "restaurant" } },
        { type: "node", id: 4, lat: 1, lon: 1, tags: { name: "Club Space", amenity: "nightclub" } },
      ],
    });
    expect(p.map((x) => [x.name, x.kind, !!x.lateNight])).toEqual([["La Sandwicherie", "food", true], ["Pérez Art Museum Miami", "sight", false], ["Club Space", "nightlife", false]]);
    expect(p[1]).toMatchObject({ id: "osm:way/2", url: "https://pamm.org", lat: 25.78 });
  });
  it("builds a radius query and identifies itself to Nominatim", async () => {
    expect(overpassQuery(25.77, -80.19)).toContain("around:1500,25.77,-80.19");
    const f = vi.fn(async () => new Response(JSON.stringify([{ lat: "25.7753", lon: "-80.1862", display_name: "Bayfront Park, Miami" }])));
    expect(await geocode("Bayfront Park, Miami", { fetchImpl: f as unknown as typeof fetch })).toEqual({ lat: 25.7753, lng: -80.1862, label: "Bayfront Park, Miami" });
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ "user-agent": expect.stringContaining("RaveRun") });
  });
});

describe("Google Places", () => {
  it("searches food and sights and maps results", async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const isFood = body.includedTypes[0] === "restaurant";
      return new Response(JSON.stringify({ places: [{ id: isFood ? "f1" : "s1", displayName: { text: isFood ? "Versailles" : "Vizcaya" }, rating: 4.5, userRatingCount: 30000, primaryType: isFood ? "cuban_restaurant" : "museum", googleMapsUri: "https://maps.google.com/?cid=1" }] }));
    });
    const p = await googlePlaces("k", 25.77, -80.19, { fetchImpl: f as unknown as typeof fetch });
    expect(p.map((x) => [x.id, x.kind, x.cuisine])).toEqual([["g:f1", "food", "cuban"], ["g:s1", "sight", "museum"]]);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ "x-goog-api-key": "k" });
  });
});
