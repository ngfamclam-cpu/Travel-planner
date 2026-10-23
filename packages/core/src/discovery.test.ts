import { describe, expect, it } from "vitest";
import { findExisting, matchingArtists, mergeFestivalDays, normalizeEventName, type DiscoveredEvent } from "./index";

const ev = (name: string, start: string, extra: Partial<DiscoveredEvent> = {}): DiscoveredEvent => ({
  source: "edmtrain", externalId: name + start, name, city: "Las Vegas", country: "US", venue: "LVMS", start, end: start, artists: [], festival: true, ...extra,
});

describe("discovery", () => {
  it("merges festival days into one event", () => {
    const m = mergeFestivalDays([
      ev("EDC Las Vegas", "2027-05-15", { artists: ["Kaskade"] }),
      ev("EDC Las Vegas", "2027-05-14", { artists: ["Subtronics"] }),
      ev("EDC Las Vegas", "2027-05-16"),
      ev("Other Fest", "2027-05-15", { venue: "Elsewhere" }),
    ]);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ start: "2027-05-14", end: "2027-05-16" });
    expect(m[0].artists.sort()).toEqual(["Kaskade", "Subtronics"]);
  });

  it("matches seeded events despite naming differences and approximate dates", () => {
    const known = [
      { id: "1", name: "Lost Lands", city: "Legend Valley, OH", start: "2027-09-17" },
      { id: "2", name: "North Coast / ARC", city: "Chicago", start: "2027-09-03" },
    ];
    expect(findExisting(ev("Lost Lands Music Festival 2027", "2027-09-19", { city: "Legend Valley" }), known)?.id).toBe("1");
    expect(findExisting(ev("North Coast Music Festival", "2027-09-03", { city: "Chicago" }), known)?.id).toBe("2"); // same festival
    expect(findExisting(ev("Coast Party", "2027-09-03", { city: "Chicago" }), known)).toBeNull(); // different name
    expect(findExisting(ev("Lost Lands", "2027-10-30", { city: "Legend Valley" }), known)).toBeNull(); // too far apart
    expect(normalizeEventName("Lost Lands Music Festival 2027")).toBe("lost lands");
  });

  it("finds your favourite artists in a lineup", () => {
    expect(matchingArtists(["SUBTRONICS", "Excision b2b Wooli", "Someone"], ["Subtronics", "Wooli", "Fisher"]).sort()).toEqual(["Subtronics", "Wooli"]);
  });
});
