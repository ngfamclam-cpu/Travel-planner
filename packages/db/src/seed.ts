// Seed data from spec §12 (as of Oct 22, 2026). Run: npm run db:seed  (add -- --reset to wipe first)
// "quoted" = price seen at the source on that date; "est" = estimate until the first real snapshot.
import { PrismaClient, type Prisma } from "@prisma/client";
import { DEFAULT_SETTINGS } from "@rave-run/core";
import { createTripFromEvent, day, type CreateTripOptions } from "./trips";

const prisma = new PrismaClient();
const AS_OF = new Date("2026-10-22T16:00:00Z");
const GF = "Google Flights";

type EventSeed = Omit<Prisma.EventCreateInput, "startDate" | "endDate"> & { start: string; end: string };

async function upsertEvent(e: EventSeed) {
  const { start, end, ...rest } = e;
  const data = { ...rest, startDate: day(start), endDate: day(end) };
  return prisma.event.upsert({
    where: { name_startDate: { name: e.name, startDate: day(start) } },
    create: data,
    update: data,
  });
}

async function eventTrip(e: EventSeed, opts: CreateTripOptions) {
  const ev = await upsertEvent(e);
  return createTripFromEvent(prisma, ev.id, opts);
}

async function tiers(eventName: string, start: string, rows: Omit<Prisma.TicketTierCreateManyInput, "eventId">[]) {
  const ev = await prisma.event.findUniqueOrThrow({ where: { name_startDate: { name: eventName, startDate: day(start) } } });
  await prisma.ticketTier.createMany({ data: rows.map((r) => ({ ...r, eventId: ev.id, observedAt: r.observedAt ?? AS_OF })) });
}

async function reset() {
  // Order matters for FKs.
  await prisma.$transaction([
    prisma.alert.deleteMany(),
    prisma.savingsMeter.deleteMany(),
    prisma.redemption.deleteMany(),
    prisma.priceSnapshot.deleteMany(),
    prisma.lineItem.deleteMany(),
    prisma.trip.deleteMany(),
    prisma.ticketTier.deleteMany(),
    prisma.event.deleteMany(),
    prisma.transferPartner.deleteMany(),
    prisma.pointsBalance.deleteMany(),
    prisma.card.deleteMany(),
    prisma.setting.deleteMany(),
    prisma.queryCache.deleteMany(),
    prisma.providerRun.deleteMany(),
  ]);
}

async function seedSettingsAndCards() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue }, update: {} });
  }

  // Seed earn rules from spec §8. Card terms change: verify and edit in Settings.
  const cards: Prisma.CardCreateInput[] = [
    {
      name: "Amex Gold",
      network: "Amex",
      foreignFeePct: 0,
      pointsCurrency: "Amex MR",
      transferEnabled: true,
      earnRules: { restaurants: 4, us_supermarkets: 4, flights_direct: 3, default: 1 },
    },
    {
      name: "Citi Custom Cash",
      network: "Mastercard",
      foreignFeePct: 3,
      pointsCurrency: "Citi TYP",
      transferEnabled: null,
      earnRules: { top_category: 5, top_category_cap_per_cycle: 500, top_category_use: "live_entertainment", eligible: ["live_entertainment", "travel", "restaurants"], default: 1 },
      notes: "Transfers only when pooled with a Strata Premier/Elite.",
    },
    {
      name: "Citi Strata",
      network: "Mastercard",
      foreignFeePct: null,
      pointsCurrency: "Citi TYP",
      transferEnabled: null,
      needsSetup: true,
      version: "unknown",
      earnRules: { default: 1 },
      notes: "Set the version (Strata / Premier / Elite) in Settings: it decides earn rates, foreign fee and airline transfers.",
    },
    {
      name: "Chase Freedom",
      network: "Visa",
      foreignFeePct: 3,
      pointsCurrency: "Chase UR",
      transferEnabled: null,
      needsSetup: true,
      version: "unknown",
      earnRules: { rotating_quarterly: 5, default: 1 },
      notes: "Points only transfer to airlines if you also hold a Sapphire (or Ink Preferred). Set in Settings.",
    },
    {
      name: "Chase Amazon (Prime Visa)",
      network: "Visa",
      foreignFeePct: 0,
      pointsCurrency: "cash back",
      transferEnabled: false,
      earnRules: { amazon_wholefoods: 5, restaurants: 2, gas: 2, default: 1 },
    },
    {
      name: "Discover",
      network: "Discover",
      foreignFeePct: 0,
      pointsCurrency: "cash back",
      transferEnabled: false,
      earnRules: { rotating_quarterly: 5, default: 1 },
      notes: "Accepted on the JCB network in Japan.",
    },
  ];
  for (const c of cards) await prisma.card.upsert({ where: { name: c.name }, create: c, update: {} });

  for (const currency of ["Amex MR", "Citi TYP", "Chase UR"]) {
    await prisma.pointsBalance.upsert({ where: { currency }, create: { currency, balance: 0 }, update: {} });
  }

  // Transfer partners: starting list only. Ratios change; verify before transferring.
  const partners: [string, string, number, string?][] = [
    ["Amex MR", "ANA Mileage Club", 1, "Check first for Japan awards"],
    ["Amex MR", "Delta SkyMiles", 1],
    ["Amex MR", "Air Canada Aeroplan", 1],
    ["Amex MR", "British Airways Avios", 1],
    ["Amex MR", "Singapore KrisFlyer", 1],
    ["Amex MR", "Virgin Atlantic", 1],
    ["Amex MR", "JetBlue TrueBlue", 0.8],
    ["Citi TYP", "Turkish Miles&Smiles", 1],
    ["Citi TYP", "Air France/KLM Flying Blue", 1],
    ["Citi TYP", "Virgin Atlantic", 1],
    ["Citi TYP", "Singapore KrisFlyer", 1],
    ["Citi TYP", "EVA Air", 1],
    ["Citi TYP", "Cathay Pacific Asia Miles", 1],
    ["Citi TYP", "JetBlue TrueBlue", 1],
    ["Chase UR", "United MileagePlus", 1, "Requires Sapphire/Ink to transfer"],
    ["Chase UR", "World of Hyatt", 1, "Requires Sapphire/Ink to transfer"],
    ["Chase UR", "Air Canada Aeroplan", 1, "Requires Sapphire/Ink to transfer"],
    ["Chase UR", "Southwest Rapid Rewards", 1, "Requires Sapphire/Ink to transfer"],
  ];
  for (const [currency, partner, ratio, notes] of partners) {
    await prisma.transferPartner.upsert({
      where: { currency_partner: { currency, partner } },
      create: { currency, partner, ratio, notes: notes ?? "Verify ratio before transferring" },
      update: {},
    });
  }
}

async function seedTrips() {
  // ---- NYE 2026 (compare slot) ----
  const NYE = "NYE 2026";

  await eventTrip(
    {
      name: "HiJinx NYE",
      brand: "HiJinx",
      city: "Philadelphia",
      venue: "Pennsylvania Convention Center",
      start: "2026-12-30",
      end: "2026-12-31",
      genres: ["dubstep", "bass", "hardstyle"],
      lineupHighlights: ["Subtronics", "Excision b2b Wooli", "Tape B", "Dabin", "DJ Diesel"],
      airports: [],
      drivableFromBoston: true,
      officialUrl: "https://hijinxfest.com",
      ticketUrl: "https://hijinxfest.com/tickets",
      notes: "Indoor, 18+.",
      status: "on_sale",
      source: "spec seed",
    },
    {
      slot: NYE,
      color: "#ec4899",
      items: [
        { kind: "ticket", label: "2-day GA", quotedAmount: 215, quotedSource: "hijinxfest.com/tickets", quotedAt: AS_OF, quotedUrl: "https://hijinxfest.com/tickets", notes: "All-in + tax. GA+ $285. Resale from ~$282." },
        { kind: "ground", label: "Amtrak BOS ↔ PHL round trip", estAmount: 180, notes: "Holiday estimate." },
        { kind: "hotel", label: "Hotel near Center City", estAmount: 240, qty: 3, notes: "NYE surge estimate. Window Dec 29–Jan 1 = 3 nights (spec estimated 2)." },
        { kind: "ground", label: "Local rideshare / SEPTA" },
      ],
    },
  );
  await tiers("HiJinx NYE", "2026-12-30", [
    { name: "2-day GA", priceAllIn: 215, feesIncluded: true, onSale: true, source: "hijinxfest.com", sourceUrl: "https://hijinxfest.com/tickets" },
    { name: "2-day GA+", priceAllIn: 285, feesIncluded: true, onSale: true, source: "hijinxfest.com", sourceUrl: "https://hijinxfest.com/tickets" },
    { name: "2-day GA (resale)", priceAllIn: 282, isResale: true, onSale: true, source: "resale floor (approx.)" },
  ]);

  const nyeAlt = async (
    e: Omit<EventSeed, "status" | "source" | "country" | "region">,
    ticket: { label: string; est?: number; quoted?: number; source?: string; notes?: string },
    color: string,
  ) => {
    const flight = e.airports && (e.airports as string[]).length;
    await eventTrip(
      { ...e, status: "on_sale", source: "spec seed" },
      {
        slot: NYE,
        color,
        items: [
          ...(flight
            ? [{
                kind: "flight" as const,
                label: `Flight BOS area → ${(e.airports as string[]).join("/")}`,
                searchSpec: { destinations: e.airports as string[] },
                notes: "Not priced yet for the actual dates: the first worker run fetches it.",
              }]
            : []),
          {
            kind: "ticket" as const,
            label: ticket.label,
            estAmount: ticket.est ?? null,
            quotedAmount: ticket.quoted ?? null,
            quotedSource: ticket.source,
            quotedAt: ticket.quoted != null ? AS_OF : null,
            notes: ticket.notes,
          },
          { kind: "hotel" as const, label: "Hotel near venue", qty: 0, notes: "Nights follow the trip window." },
          { kind: "ground" as const, label: "Airport/venue transport" },
        ],
      },
    );
  };

  await nyeAlt(
    { name: "Eternal NYE", city: "Orlando", venue: "Orlando Amphitheater", start: "2026-12-30", end: "2026-12-31", genres: ["bass", "dubstep"], lineupHighlights: ["Zeds Dead (final set before hiatus)", "Knock2", "RL Grime", "LSDREAM"], airports: ["MCO"] },
    { label: "2-day GA", est: 220 },
    "#22d3ee",
  );
  await nyeAlt(
    { name: "Lights All Night", city: "Dallas", venue: "Fair Park", start: "2026-12-30", end: "2026-12-31", genres: ["house", "bass", "big room"], lineupHighlights: ["Tiësto", "Chris Lake", "Subtronics", "Gryffin"], airports: ["DFW", "DAL"] },
    { label: "2-day GA (tier 2)", quoted: 229.95, source: "Lights All Night official", notes: "Single day $119.95." },
    "#facc15",
  );
  await nyeAlt(
    { name: "Countdown NYE", city: "San Bernardino", venue: "NOS Events Center", start: "2026-12-30", end: "2026-12-31", genres: ["bass", "big room", "melodic"], lineupHighlights: ["DJ Snake", "Marshmello", "Alesso", "Subtronics", "Seven Lions"], airports: ["ONT", "LAX"] },
    { label: "2-day GA", est: 300 },
    "#f97316",
  );
  await nyeAlt(
    { name: "Decadence Arizona", city: "Phoenix", venue: "Phoenix Raceway", start: "2026-12-30", end: "2026-12-31", genres: ["house", "techno", "bass"], lineupHighlights: ["Chris Lake", "KETTAMA", "I Hate Models", "SLANDER", "Levity", "ISOxo"], airports: ["PHX"] },
    { label: "2-day GA", est: 330 },
    "#f43f5e",
  );
  await nyeAlt(
    { name: "Decadence Colorado", city: "Denver", venue: "Colorado Convention Center", start: "2026-12-30", end: "2026-12-31", genres: ["bass", "dubstep", "big room"], lineupHighlights: ["Excision", "GRiZ", "Zeds Dead", "Marshmello", "DJ Snake", "Alesso"], airports: ["DEN"] },
    { label: "2-day GA (tier 4, last tier)", quoted: 383.64, source: "Decadence official", notes: "Last tier: no cheaper tier left." },
    "#60a5fa",
  );
  await nyeAlt(
    { name: "Proper NYE/NYD", city: "San Diego", venue: "Petco Park", start: "2026-12-31", end: "2027-01-01", genres: ["house", "techno"], lineupHighlights: ["Kaskade", "FISHER", "Four Tet b2b Tiga", "Sara Landry"], airports: ["SAN"] },
    { label: "2-day GA", est: 280 },
    "#4ade80",
  );
  await nyeAlt(
    { name: "NYC club NYE", city: "Brooklyn", venue: "TBA", start: "2026-12-31", end: "2026-12-31", genres: ["techno", "house"], lineupHighlights: [], airports: [], drivableFromBoston: true, datesTentative: false, notes: "2026 lineups TBA." },
    { label: "NYE club ticket", notes: "Last year $120–240; 2026 lineups TBA." },
    "#a855f7",
  );

  // Fix hotel nights for the NYE alternatives now that windows exist.
  const alts = await prisma.trip.findMany({ where: { slot: NYE }, include: { lineItems: true } });
  for (const t of alts) {
    const n = Math.round((t.departDate.getTime() - t.arriveDate.getTime()) / 86_400_000);
    for (const li of t.lineItems) {
      if (li.kind === "hotel" && li.qty === 0) {
        await prisma.lineItem.update({ where: { id: li.id }, data: { qty: n, label: `Hotel near venue, ${n} nights` } });
      }
    }
  }

  // ---- Ultra Miami ----
  await eventTrip(
    {
      name: "Ultra Miami",
      brand: "Ultra",
      city: "Miami",
      venue: "Bayfront Park",
      start: "2027-03-26",
      end: "2027-03-28",
      genres: ["big room", "techno", "house", "bass"],
      lineupHighlights: [],
      airports: ["MIA", "FLL"],
      officialUrl: "https://ultramusicfestival.com",
      notes: "Miami Music Week + spring break: surge week.",
      status: "sold_out",
      source: "spec seed",
    },
    {
      status: "planned",
      color: "#22d3ee",
      items: [
        {
          kind: "flight",
          label: "Flight BOS area → MIA/FLL",
          quotedAmount: 427,
          quotedSource: GF,
          quotedAt: AS_OF,
          insightLabel: "high",
          searchSpec: { destinations: ["MIA", "FLL"] },
          notes: "Nonstop, Mar 25–29. Google: prices are currently high.",
        },
        { kind: "ticket", label: "GA (resale)", quotedAmount: 517, quotedSource: "Vivid Seats resale, Sept 2026", notes: "Official early tiers sold out; waitlist on Front Gate. Signal: WATCH." },
        { kind: "hotel", label: "Hotel Downtown/Brickell", estAmount: 350, qty: 4, searchSpec: { query: "hotels in Downtown Miami and Brickell" }, notes: "Miami Music Week + spring break estimate. Window Mar 25–29 = 4 nights (spec estimated 3)." },
        { kind: "ground", label: "Airport ↔ hotel ↔ Bayfront Park" },
      ],
    },
  );
  await tiers("Ultra Miami", "2027-03-26", [
    { name: "GA (early tiers)", soldOut: true, source: "Front Gate", tierLabel: "Waitlist open" },
    { name: "GA (resale)", priceAllIn: 517, isResale: true, onSale: true, source: "Vivid Seats", observedAt: new Date("2026-09-15T12:00:00Z") },
  ]);

  // ---- EDC Las Vegas (Dusk) ----
  await eventTrip(
    {
      name: "EDC Las Vegas — Dusk weekend",
      brand: "EDC",
      city: "Las Vegas",
      venue: "Las Vegas Motor Speedway",
      start: "2027-05-14",
      end: "2027-05-16",
      genres: ["big room", "bass", "trance", "house", "hardstyle"],
      lineupHighlights: [],
      airports: ["LAS"],
      officialUrl: "https://lasvegas.electricdaisycarnival.com",
      notes: "Dawn weekend (May 21–23) sold out. $5 deposit payment plan.",
      status: "on_sale",
      source: "spec seed",
    },
    {
      status: "planned",
      color: "#facc15",
      items: [
        { kind: "flight", label: "Flight BOS area → LAS", quotedAmount: 405, quotedSource: GF, quotedAt: AS_OF, insightLabel: "typical", searchSpec: { destinations: ["LAS"] }, notes: "Nonstop May 13–17 ($403 1-stop). Google: typical." },
        { kind: "ticket", label: "One-weekend GA (Dusk)", quotedAmount: 399.99, quotedSource: "EDC official", quotedAt: AS_OF, notes: "All-in. $5 deposit payment plan." },
        { kind: "hotel", label: "Hotel, Las Vegas Strip", estAmount: 210, qty: 4, searchSpec: { query: "hotels on the Las Vegas Strip" }, notes: "EDC shuttles leave from the Strip, so stay there rather than near the speedway." },
        { kind: "ground", label: "EDC shuttle pass", estAmount: 140 },
      ],
    },
  );
  await tiers("EDC Las Vegas — Dusk weekend", "2027-05-14", [
    { name: "One-weekend GA (Dusk)", priceAllIn: 399.99, feesIncluded: true, onSale: true, source: "EDC official" },
    { name: "One-weekend GA (Dawn, May 21–23)", soldOut: true, source: "EDC official" },
  ]);

  // ---- Asia spring 2027 (compare slot) ----
  const ASIA = "Asia spring 2027";
  const gmo = await upsertEvent({
    name: "GMO Sonic",
    city: "Tokyo",
    country: "JP",
    region: "Asia",
    venue: "TBA",
    start: "2027-04-03",
    end: "2027-04-04",
    genres: ["bass", "big room", "house"],
    lineupHighlights: [],
    airports: ["HND", "NRT"],
    notes: "Price TBA.",
    status: "announced",
    source: "spec seed",
  });
  await createTripFromEvent(prisma, gmo.id, {
    name: "Tokyo — Option B (after Ultra)",
    slot: ASIA,
    color: "#f472b6",
    arrive: "2027-03-30",
    depart: "2027-04-11",
    notes: "Cherry blossom season. Only 1 day home after Ultra.",
    items: [
      { kind: "flight", label: "Flight BOS area → Tokyo (HND/NRT)", quotedAmount: 1429, quotedSource: GF, quotedAt: AS_OF, insightLabel: "typical", searchSpec: { destinations: ["HND", "NRT"] }, notes: "1-stop. Google: typical." },
      { kind: "hotel", label: "Hotel, Tokyo", estAmount: 150, qty: 12, searchSpec: { query: "hotels in Shinjuku, Tokyo" }, notes: "Will rise for cherry blossom." },
      { kind: "ticket", label: "GMO Sonic ticket", notes: "Price TBA." },
      { kind: "ground", label: "Airport ↔ city + transit" },
    ],
  });
  await prisma.trip.create({
    data: {
      name: "Tokyo — Option A (before Ultra)",
      slot: ASIA,
      color: "#c084fc",
      arriveDate: day("2027-03-05"),
      departDate: day("2027-03-17"),
      flexDays: 2,
      notes: "Early March, before Ultra: misses GMO Sonic and peak cherry blossom. Dates are a placeholder; adjust.",
      lineItems: {
        create: [
          { kind: "flight", label: "Flight BOS area → Tokyo (HND/NRT)", searchSpec: { destinations: ["HND", "NRT"] }, notes: "Not priced yet: the first worker run fetches it.", sortOrder: 0 },
          { kind: "hotel", label: "Hotel, Tokyo", estAmount: 150, qty: 12, searchSpec: { query: "hotels in Shinjuku, Tokyo" }, notes: "Estimate carried from Option B.", sortOrder: 1 },
          { kind: "ground", label: "Airport ↔ city + transit", sortOrder: 2 },
        ],
      },
    },
  });
}

async function seedDiscovery() {
  const us: [string, string, string, string, boolean?][] = [
    ["Time Warp NYC", "New York", "2026-11-20", "2026-11-21", true],
    ["Neon City", "Las Vegas", "2026-11-20", "2026-11-22"],
    ["Tropical Dreams", "Sturbridge", "2027-01-15", "2027-01-16", true],
    ["Groove Cruise Miami", "Miami", "2027-01-21", "2027-01-25"],
    ["Wasteland", "Orlando", "2027-02-05", "2027-02-06"],
    ["We Belong Here", "Miami", "2027-02-26", "2027-02-28"],
    ["Breakaway Tampa", "Tampa", "2027-04-16", "2027-04-17"],
    ["Forbidden Kingdom", "Orlando", "2027-04-23", "2027-04-25"],
    ["Breakaway Atlanta", "Atlanta", "2027-05-14", "2027-05-15"],
    ["Movement", "Detroit", "2027-05-29", "2027-05-31"],
    ["Project Glow", "Washington DC", "2027-06-05", "2027-06-06"],
    ["Beyond Wonderland Midwest", "Chicago area", "2027-06-10", "2027-06-13"],
    ["ASOT LA", "Los Angeles", "2027-06-11", "2027-06-12"],
    ["Beyond Wonderland at the Gorge", "George, WA", "2027-06-25", "2027-06-27"],
    ["Big Dub", "Pennsylvania", "2027-07-25", "2027-07-29", true],
    ["Elements", "Lakewood, PA", "2027-08-06", "2027-08-08", true],
    ["Bass Canyon", "George, WA", "2027-08-13", "2027-08-15"],
    ["North Coast / ARC", "Chicago", "2027-09-03", "2027-09-06"],
  ];
  for (const [name, city, start, end, drivable] of us) {
    await upsertEvent({
      name, city, start, end, genres: [], lineupHighlights: [], airports: [],
      drivableFromBoston: !!drivable, source: "Edmtrain (spec seed)",
      notes: name === "Neon City" ? "Free event." : undefined,
    });
  }
  await upsertEvent({ name: "Lost Lands", city: "Legend Valley, OH", start: "2027-09-17", end: "2027-09-19", datesTentative: true, genres: ["dubstep", "bass"], lineupHighlights: [], airports: [], source: "Edmtrain (spec seed)", notes: "September, dates TBA." });

  const asia: [string, string, string, string, string, boolean?][] = [
    ["Ultra Taiwan", "Taipei", "TW", "2026-11-14", "2026-11-14"],
    ["VAC Festival", "Zhuhai", "CN", "2026-11-28", "2026-11-29"],
    ["EDC China", "Guangzhou", "CN", "2026-11-21", "2026-11-22", true],
    ["S2O Songkran", "Bangkok", "TH", "2027-04-13", "2027-04-15", true],
    ["World DJ Festival", "Seoul", "KR", "2027-06-05", "2027-06-06", true],
    ["Storm Festival", "Shenzhen", "CN", "2027-06-19", "2027-06-20", true],
    ["Waterbomb Seoul", "Seoul", "KR", "2027-07-24", "2027-07-25", true],
    ["EDC Korea", "Incheon", "KR", "2027-10-09", "2027-10-10", true],
  ];
  for (const [name, city, country, start, end, tentative] of asia) {
    await upsertEvent({
      name, city, country, region: "Asia", start, end, datesTentative: !!tentative,
      genres: [], lineupHighlights: [], airports: [], source: "spec seed",
      notes: tentative ? "Dates approximate until announced." : undefined,
    });
  }
}

async function main() {
  if (process.argv.includes("--reset")) {
    console.log("Resetting data…");
    await reset();
  }
  await seedSettingsAndCards();
  if ((await prisma.trip.count()) > 0) {
    console.log("Trips already exist; skipping trip/event seed (use --reset to start over).");
    return;
  }
  await seedTrips();
  await seedDiscovery();
  const [events, trips, items] = await Promise.all([prisma.event.count(), prisma.trip.count(), prisma.lineItem.count()]);
  console.log(`Seeded ${events} events, ${trips} trips, ${items} line items.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
