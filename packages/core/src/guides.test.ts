import { describe, expect, it } from "vitest";
import { opensLate, survivalNotes, templateGuide, verifyPicks, type GuideContext, type Place } from "./index";

const ctx: GuideContext = {
  tripName: "Ultra Miami", venue: "Bayfront Park", city: "Miami", country: "US", eventStart: "2027-03-26", eventEnd: "2027-03-28",
  arrive: "2027-03-25", depart: "2027-03-29", indoor: false, groundItems: ["Airport ↔ hotel ↔ Bayfront Park"], hotelArea: "Brickell",
};
const places: Place[] = [
  { id: "a", name: "Versailles", kind: "food", cuisine: "cuban", rating: 4.5, ratingCount: 30000 },
  { id: "b", name: "La Sandwicherie", kind: "food", cuisine: "sandwich", lateNight: true, rating: 4.6, ratingCount: 5000 },
  { id: "c", name: "Pérez Art Museum", kind: "sight", rating: 4.6, ratingCount: 9000 },
  { id: "d", name: "Random Chain", kind: "food" },
];

describe("arrival guides", () => {
  it("template: late-night food first, then by rating; sights for off days", () => {
    const g = templateGuide(ctx, { label: "Bayfront Park, Miami", lat: 25.77, lng: -80.19 }, places, "OpenStreetMap");
    expect(g.food.map((f) => f.name)).toEqual(["La Sandwicherie", "Versailles", "Random Chain"]);
    expect(g.food[0].why).toContain("open late");
    expect(g.todo.map((t) => t.name)).toEqual(["Pérez Art Museum"]);
    expect(g.survival.join(" ")).toContain("Miami in March");
  });
  it("only keeps picks that are real places from the list", () => {
    const v = verifyPicks([{ placeId: "a", why: "Cuban classic" }, { placeId: "zzz", why: "made up" }, { placeId: "a", why: "dup" }], places);
    expect(v).toEqual([{ placeId: "a", name: "Versailles", why: "Cuban classic", lateNight: undefined, url: undefined }]);
  });
  it("adds country tips abroad", () => {
    expect(survivalNotes({ ...ctx, country: "JP", city: "Tokyo" }).join(" ")).toContain("Suica");
  });
  it("reads late opening hours", () => {
    expect(opensLate("Mo-Su 11:00-03:00")).toBe(true);
    expect(opensLate("24/7")).toBe(true);
    expect(opensLate("Mo-Fr 08:00-22:00")).toBe(false);
    expect(opensLate("Fr-Sa 18:00-00:00")).toBe(false);
  });
});
