// Ticket price tracker: one event, many platforms (official, resale, bid/ask, peer-to-peer).
// Compares all-in prices; Radiate is shown but never counted (peer-to-peer, scam risk).

export type TicketPlatformId =
  | "ticketmaster"
  | "seatgeek"
  | "stubhub"
  | "vividseats"
  | "crowdvolt"
  | "dice"
  | "ra"
  | "radiate";

export interface TicketPlatform {
  id: TicketPlatformId;
  name: string;
  /** How prices arrive: official API, a daily look at the public event page, or logged by hand. */
  access: "api" | "page" | "manual";
  kind: "official" | "resale" | "bidask" | "p2p";
  domain: string | null;
  /** Fee % added to listed prices that exclude fees (an estimate: edit in Settings). */
  defaultFeePct: number;
  /** Whether the price the platform shows already includes buyer fees. */
  listedIncludesFees: boolean;
  /** Peer-to-peer: shown with a warning, never in totals or alerts. */
  risky: boolean;
  /** Only added automatically for NYC-area events. */
  nycOnly?: boolean;
  searchUrl: (q: string) => string;
}

const google = (domain: string) => (q: string) => `https://www.google.com/search?q=${encodeURIComponent(`site:${domain} ${q}`)}`;

export const TICKET_PLATFORMS: Record<TicketPlatformId, TicketPlatform> = {
  ticketmaster: {
    id: "ticketmaster", name: "Ticketmaster", access: "api", kind: "official", domain: "ticketmaster.com",
    defaultFeePct: 22, listedIncludesFees: false, risky: false,
    searchUrl: (q) => `https://www.ticketmaster.com/search?q=${encodeURIComponent(q)}`,
  },
  seatgeek: {
    id: "seatgeek", name: "SeatGeek", access: "api", kind: "resale", domain: "seatgeek.com",
    defaultFeePct: 25, listedIncludesFees: false, risky: false,
    searchUrl: (q) => `https://seatgeek.com/search?search=${encodeURIComponent(q)}`,
  },
  stubhub: {
    id: "stubhub", name: "StubHub", access: "page", kind: "resale", domain: "stubhub.com",
    defaultFeePct: 30, listedIncludesFees: false, risky: false,
    searchUrl: (q) => `https://www.stubhub.com/secure/search?q=${encodeURIComponent(q)}`,
  },
  vividseats: {
    id: "vividseats", name: "Vivid Seats", access: "page", kind: "resale", domain: "vividseats.com",
    defaultFeePct: 30, listedIncludesFees: false, risky: false,
    searchUrl: (q) => `https://www.vividseats.com/search?searchTerm=${encodeURIComponent(q)}`,
  },
  crowdvolt: {
    id: "crowdvolt", name: "CrowdVolt", access: "page", kind: "bidask", domain: "crowdvolt.com",
    defaultFeePct: 8, listedIncludesFees: false, risky: false, nycOnly: true,
    searchUrl: google("crowdvolt.com"),
  },
  dice: {
    id: "dice", name: "DICE", access: "page", kind: "official", domain: "dice.fm",
    defaultFeePct: 0, listedIncludesFees: true, risky: false,
    searchUrl: google("dice.fm"),
  },
  ra: {
    id: "ra", name: "Resident Advisor", access: "page", kind: "official", domain: "ra.co",
    defaultFeePct: 10, listedIncludesFees: false, risky: false,
    searchUrl: google("ra.co/events"),
  },
  radiate: {
    id: "radiate", name: "Radiate", access: "manual", kind: "p2p", domain: null,
    defaultFeePct: 0, listedIncludesFees: true, risky: true,
    searchUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(`Radiate app ${q} tickets`)}`,
  },
};

export const TICKET_PLATFORM_IDS = Object.keys(TICKET_PLATFORMS) as TicketPlatformId[];

const NYC = ["new york", "nyc", "brooklyn", "queens", "manhattan", "bronx", "staten island", "jersey city", "hoboken"];
export function isNycArea(city: string | null | undefined): boolean {
  const c = (city ?? "").toLowerCase();
  return NYC.some((n) => c.includes(n));
}

/** Platforms tracked by default for an event. Other platforms can be added by hand. */
export function defaultTicketPlatforms(event: { city: string; region?: string }): TicketPlatformId[] {
  const nyc = isNycArea(event.city);
  return TICKET_PLATFORM_IDS.filter((id) => {
    const p = TICKET_PLATFORMS[id];
    if (p.nycOnly) return nyc;
    if (event.region === "Asia") return id === "radiate"; // US platforms rarely list Asian festivals
    return true;
  });
}

/** Turn a listed price into a comparable all-in price. */
export function allInPrice(
  listed: number,
  feesIncluded: boolean,
  feePct: number,
): { allIn: number; feesEstimated: boolean } {
  if (feesIncluded || feePct <= 0) return { allIn: round2(listed), feesEstimated: false };
  return { allIn: round2(listed * (1 + feePct / 100)), feesEstimated: true };
}

export function feePctFor(platform: TicketPlatformId, overrides: Partial<Record<TicketPlatformId, number>> = {}): number {
  return overrides[platform] ?? TICKET_PLATFORMS[platform].defaultFeePct;
}

export interface TicketQuote {
  platform: TicketPlatformId;
  allIn: number;
  listed: number;
  feesEstimated: boolean;
  highestBid?: number | null;
  tierLabel?: string | null;
  observedAt: Date;
  url?: string | null;
  source: "api" | "page" | "manual";
  risky: boolean;
}

/** Cheapest fresh, non-risky price across platforms (Radiate never counts). */
export function lowestTicket(quotes: TicketQuote[], now = new Date(), maxAgeHours = 48): TicketQuote | null {
  const fresh = quotes.filter((q) => !q.risky && now.getTime() - q.observedAt.getTime() <= maxAgeHours * 3_600_000);
  return fresh.sort((a, b) => a.allIn - b.allIn)[0] ?? null;
}

/** Latest quote per platform. */
export function latestPerPlatform(quotes: TicketQuote[]): Map<TicketPlatformId, TicketQuote> {
  const out = new Map<TicketPlatformId, TicketQuote>();
  for (const q of [...quotes].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())) {
    if (!out.has(q.platform)) out.set(q.platform, q);
  }
  return out;
}

export interface TicketAlertCandidate {
  kind: "ticket_target" | "ticket_drop" | "ticket_onsale" | "ticket_soldout" | "crowdvolt_gap";
  dedupeKey: string;
  title: string;
  body: string;
  amount?: number;
  url?: string | null;
  platform?: TicketPlatformId;
}

export interface TicketAlertInput {
  eventId: string;
  eventName: string;
  target: number | null;
  /** Today's latest quote per platform. */
  current: TicketQuote[];
  /** Cross-platform lowest from before this check (null if none). */
  previousLowest: number | null;
  /** Official status changes seen this run, e.g. Ticketmaster offsale → onsale. */
  statusChanges: { platform: TicketPlatformId; from: string | null; to: string; url?: string | null }[];
  dropMin?: number;
  dropPct?: number;
  crowdvoltGap: number;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** All alert rules the user asked for, as pure logic. Radiate never triggers alerts. */
export function ticketAlerts(i: TicketAlertInput, now = new Date()): TicketAlertCandidate[] {
  const out: TicketAlertCandidate[] = [];
  const counted = i.current.filter((q) => !q.risky);
  const low = lowestTicket(counted, now);
  const est = (q: TicketQuote) => (q.feesEstimated ? " (fees estimated)" : "");

  if (low && i.target != null && low.allIn <= i.target) {
    out.push({
      kind: "ticket_target",
      dedupeKey: `ticket_target:${i.eventId}:${low.platform}:${Math.round(low.allIn)}`,
      title: `${i.eventName}: ${money(low.allIn)} on ${TICKET_PLATFORMS[low.platform].name}, under your ${money(i.target)} target`,
      body: `${low.tierLabel ? `${low.tierLabel}, ` : ""}${money(low.allIn)} all-in${est(low)}. Check the listing before buying; prices move fast.`,
      amount: round2(i.target - low.allIn),
      url: low.url,
      platform: low.platform,
    });
  }

  if (low && i.previousLowest != null) {
    const drop = i.previousLowest - low.allIn;
    if (drop >= Math.max(i.dropMin ?? 15, i.previousLowest * (i.dropPct ?? 0.05))) {
      out.push({
        kind: "ticket_drop",
        dedupeKey: `ticket_drop:${i.eventId}:${Math.round(low.allIn)}`,
        title: `${i.eventName}: lowest ticket down ${money(drop)} to ${money(low.allIn)}`,
        body: `New lowest anywhere is ${TICKET_PLATFORMS[low.platform].name}${low.tierLabel ? ` (${low.tierLabel})` : ""} at ${money(low.allIn)} all-in${est(low)}, was ${money(i.previousLowest)}.`,
        amount: round2(drop),
        url: low.url,
        platform: low.platform,
      });
    }
  }

  for (const c of i.statusChanges) {
    const name = TICKET_PLATFORMS[c.platform].name;
    if (c.to === "onsale" && c.from && c.from !== "onsale") {
      out.push({
        kind: "ticket_onsale",
        dedupeKey: `ticket_onsale:${i.eventId}:${c.platform}:${now.toISOString().slice(0, 10)}`,
        title: `${i.eventName}: face-value tickets back on sale on ${name}`,
        body: `Status changed from ${c.from} to on sale. Face value is usually the cheapest option; buy before it flips again.`,
        url: c.url,
        platform: c.platform,
      });
    } else if ((c.to === "offsale" || c.to === "soldout") && c.from === "onsale") {
      out.push({
        kind: "ticket_soldout",
        dedupeKey: `ticket_soldout:${i.eventId}:${c.platform}:${now.toISOString().slice(0, 10)}`,
        title: `${i.eventName}: ${name} face value is ${c.to === "soldout" ? "sold out" : "off sale"}`,
        body: "Resale is now the only option there; the next tier (if any) may open soon.",
        url: c.url,
        platform: c.platform,
      });
    }
  }

  const cv = counted.find((q) => q.platform === "crowdvolt" && q.highestBid != null);
  if (cv && cv.highestBid != null && cv.listed - cv.highestBid <= i.crowdvoltGap) {
    out.push({
      kind: "crowdvolt_gap",
      dedupeKey: `crowdvolt_gap:${i.eventId}:${Math.round(cv.listed)}:${Math.round(cv.highestBid)}`,
      title: `${i.eventName}: CrowdVolt ask ${money(cv.listed)} vs bid ${money(cv.highestBid)}`,
      body: `Only ${money(cv.listed - cv.highestBid)} between the lowest ask and the highest bid. A bid near the ask may fill.`,
      amount: round2(cv.listed - cv.highestBid),
      url: cv.url,
      platform: "crowdvolt",
    });
  }
  return out;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
