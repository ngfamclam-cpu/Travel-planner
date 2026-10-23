// Loads clearly-labelled FAKE prices so the app can be tried before any API keys exist.
// Runs the real flight, hotel and ticket jobs against fake "DEMO" providers.
// Clear it with: npm run db:reset
import { prisma, recordTicketPrice } from "@rave-run/db";
import type { FlightOffer, FlightQuery, HotelOffer, HotelQuery, TicketPlatformId } from "@rave-run/core";
import type { FlightProvider, HotelProvider, ProviderResult, TicketCheck, TicketChecker } from "@rave-run/providers";
import { runFlightJob } from "./jobs/flights";
import { runHotelJob } from "./jobs/hotels";
import { runTicketJob } from "./jobs/tickets";
import { runDiscovery } from "./jobs/discovery";
import { runSignals } from "./jobs/signals";
import { runBrief } from "./jobs/brief";
import { runGuides } from "./jobs/guides";

const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1000, 7);
let at = new Date();

const flights: FlightProvider = {
  info: { name: "demo_flights", tier: "free", configured: true, envKeys: [] },
  async search(q: FlightQuery): Promise<ProviderResult<FlightOffer>> {
    const d = q.destinations;
    const base = d.includes("HND") ? 1380 : d.includes("LAS") ? 360 : d.includes("MIA") ? 390 : d.some((x) => ["LAX", "ONT", "SAN"].includes(x)) ? 420 : 330;
    const p = base + ([5, 6].includes(dow(q.outboundDate)) ? 70 : 0) + (dow(q.returnDate) === 0 ? 55 : 0) + (hash(q.outboundDate + q.returnDate) % 45);
    const mk = (origin: string, price: number, stops: number): FlightOffer => ({
      provider: "demo_flights", price, currency: "USD", origin, destination: d[0], outboundDate: q.outboundDate, returnDate: q.returnDate,
      stops, carrier: "DEMO Air", insightLabel: p > base + 60 ? "high" : "typical",
    });
    return { ok: true, provider: "demo_flights", cached: false, fetchedAt: at, raw: { demo: true }, offers: [mk("BOS", p, 0), mk("JFK", p - 45, 1)] };
  },
};

const hotels: HotelProvider = {
  info: { name: "demo_hotels", tier: "free", configured: true, envKeys: [] },
  async search(q: HotelQuery): Promise<ProviderResult<HotelOffer>> {
    const n = Math.round((Date.parse(q.checkOut) - Date.parse(q.checkIn)) / 86_400_000);
    const month = q.checkIn.slice(5, 7);
    const per = (["03", "05", "12"].includes(month) || q.checkIn.startsWith("2027-01-01") ? 290 : 140) + (hash(q.checkIn) % 30) + ([5, 6].includes(dow(q.checkIn)) ? 25 : 0);
    const mk = (name: string, p: number, stars: number | undefined, rating5: number, type?: string): HotelOffer => ({
      provider: "demo_hotels", name, pricePerNight: p, total: p * n, currency: "USD", stars, rating5, refundable: true, lodgingType: type,
      bookingUrl: "https://www.google.com/travel/hotels",
    });
    const offers =
      q.lodging === "rentals"
        ? [mk("DEMO 1BR condo", per - 70, undefined, 4.6, "vacation rental"), mk("DEMO studio loft", per - 40, undefined, 4.2, "vacation rental")]
        : [mk("DEMO Budget Inn", per - 90, 2, 3.4), mk("DEMO Central Hotel", per, 3, 4.1), mk("DEMO Boutique", per + 35, 4, 4.5), mk("DEMO Grand", per + 110, 5, 4.7)];
    return { ok: true, provider: "demo_hotels", cached: false, fetchedAt: at, raw: { demo: true }, offers };
  },
};

function ticketChecker(platform: TicketPlatformId, mult: number, extra: Partial<TicketCheck> = {}): TicketChecker {
  return {
    platform, configured: true, envKeys: [],
    find: async (e) => ({ url: `https://example.com/demo/${platform}/${encodeURIComponent(e.name)}`, externalId: "demo" }),
    async check(w): Promise<TicketCheck> {
      const name = decodeURIComponent((w.url ?? "").split("/").pop() ?? "");
      const base = 150 + (hash(name) % 300);
      return { ok: true, platform, listed: Math.round(base * mult), feesIncluded: false, tierLabel: "DEMO GA", url: w.url!, ...extra } as TicketCheck;
    },
  };
}

async function main() {
  if (!process.argv.includes("--yes")) {
    console.log("This loads FAKE prices labelled DEMO into the database. Re-run with --yes to continue.\nClear them later with: npm run db:reset");
    return;
  }
  const blocked: TicketChecker = { platform: "stubhub", configured: true, envKeys: [], check: async () => ({ ok: false, platform: "stubhub", error: "DEMO: pretend the site blocked the automated check", blocked: true }) };
  const checkers = {
    ticketmaster: ticketChecker("ticketmaster", 0.8, { tierLabel: "DEMO face value", status: "onsale" }),
    seatgeek: ticketChecker("seatgeek", 0.95),
    stubhub: blocked,
    vividseats: ticketChecker("vividseats", 0.9),
    crowdvolt: {
      ...ticketChecker("crowdvolt", 0.85),
      // Bid $12 under the ask, so the CrowdVolt bid/ask alert shows up.
      async check(w) {
        const r = await ticketChecker("crowdvolt", 0.85).check(w);
        return r.ok ? { ...r, highestBid: r.listed - 12 } : r;
      },
    },
    dice: ticketChecker("dice", 0.75, { feesIncluded: true }),
    ra: ticketChecker("ra", 0.82),
    radiate: ticketChecker("radiate", 0.5),
  } as Record<TicketPlatformId, TicketChecker>;

  // Pin a hotel and turn on rentals for Ultra so every hotel pick has data.
  const ultraHotel = await prisma.lineItem.findFirst({ where: { kind: "hotel", trip: { name: "Ultra Miami" } } });
  if (ultraHotel) {
    await prisma.lineItem.update({ where: { id: ultraHotel.id }, data: { searchSpec: { ...((ultraHotel.searchSpec as object) ?? {}), pinned: { name: "DEMO Grand" }, includeRentals: true } } });
  }
  const club = await prisma.event.findFirst({ where: { name: "NYC club NYE" } });

  // Three simulated days so sparklines have history.
  for (let d = 2; d >= 0; d--) {
    at = new Date(Date.now() - d * 86_400_000);
    await runFlightJob(prisma, flights, { now: at, budget: 500, log: () => {} });
    await runHotelJob(prisma, hotels, { now: at, budget: 500, log: () => {} });
    await runTicketJob(prisma, checkers, { now: at, findBudget: 100, log: () => {} });
    await runSignals(prisma, { now: at, log: () => {} });
    // After day one, set a target just above the lowest NYC club price so a target alert shows up.
    if (d === 2 && club) {
      const low = await prisma.ticketPrice.findFirst({ where: { eventId: club.id, risky: false }, orderBy: { allInPrice: "asc" } });
      if (low) await prisma.event.update({ where: { id: club.id }, data: { ticketTarget: Math.round(Number(low.allInPrice)) + 15, ticketTierHint: "GA" } });
    }
  }
  // Two fake "discovered" festivals so Discover shows new events and artist matches.
  await runDiscovery(
    prisma,
    [
      {
        name: "edmtrain",
        configured: true,
        envKey: "",
        fetch: async () => [
          { source: "edmtrain", externalId: "demo-1", name: "DEMO Bass Coast Fest", city: "Austin", country: "US", venue: "DEMO Park", start: "2027-06-18", end: "2027-06-20", artists: ["Subtronics", "Excision", "DEMO DJ"], url: null, festival: true },
          { source: "edmtrain", externalId: "demo-2", name: "DEMO House Weekender", city: "Atlanta", country: "US", venue: "DEMO Hall", start: "2027-05-15", end: "2027-05-16", artists: ["DEMO House Act"], url: null, festival: true },
        ],
      },
    ],
    { log: () => {} },
  );
  // Mark every tracked ticket price as demo, and add one hand-logged Radiate price.
  await prisma.ticketPrice.updateMany({ data: { source: "demo", note: "DEMO data (fake)" } });
  if (club) {
    const w = await prisma.ticketWatch.findFirst({ where: { eventId: club.id, platform: "radiate" } });
    if (w) await recordTicketPrice(prisma, w, { listed: 80, feesIncluded: true, source: "manual", tierLabel: "GA", note: "DEMO: seller has 3 vouches" });
  }
  // Arrival guides for planned trips from fake DEMO places (plain guides: no map lookups, no Claude).
  const demoPlaces = (lat: number, lng: number) =>
    Promise.resolve([
      { id: "demo:1", name: "DEMO Cuban Café", kind: "food" as const, cuisine: "cuban", rating: 4.6, ratingCount: 2400, lat, lng },
      { id: "demo:2", name: "DEMO Late Night Tacos", kind: "food" as const, cuisine: "mexican", lateNight: true, rating: 4.4, ratingCount: 900, lat, lng },
      { id: "demo:3", name: "DEMO Noodle Bar", kind: "food" as const, cuisine: "ramen", rating: 4.5, ratingCount: 1500, lat, lng },
      { id: "demo:4", name: "DEMO Seafood Shack", kind: "food" as const, cuisine: "seafood", rating: 4.3, ratingCount: 700, lat, lng },
      { id: "demo:5", name: "DEMO Art Museum", kind: "sight" as const, rating: 4.7, ratingCount: 9000, lat, lng },
      { id: "demo:6", name: "DEMO Waterfront Park", kind: "park" as const, rating: 4.6, ratingCount: 5000, lat, lng },
    ]);
  await runGuides(prisma, { geocode: async () => ({ lat: 0, lng: 0, label: "DEMO location" }), places: demoPlaces, placesSource: "DEMO places (fake)", writer: null }, { log: () => {} });
  // Today's brief from the demo data (plain summary: no Claude call, nothing emailed or pushed).
  await prisma.setting.upsert({ where: { key: "briefChannels" }, create: { key: "briefChannels", value: { push: false, email: false } }, update: {} });
  await runBrief(prisma, {}, { force: true, log: () => {} });
  await prisma.setting.update({ where: { key: "briefChannels" }, data: { value: { push: true, email: true } } });
  await prisma.setting.upsert({ where: { key: "demoDataLoadedAt" }, create: { key: "demoDataLoadedAt", value: new Date().toISOString() }, update: { value: new Date().toISOString() } });
  const [snaps, tickets, alerts] = await Promise.all([prisma.priceSnapshot.count(), prisma.ticketPrice.count(), prisma.alert.count({ where: { dismissedAt: null } })]);
  console.log(`DEMO data loaded: ${snaps} flight/hotel prices, ${tickets} ticket prices, ${alerts} alerts. Clear with: npm run db:reset`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
