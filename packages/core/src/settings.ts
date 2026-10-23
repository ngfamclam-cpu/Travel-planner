// App settings with defaults (spec §1, §11). Stored as key → JSON in the settings table.

export interface OriginAirport {
  code: string;
  label: string;
  /** Round-trip cost of getting to this airport from home (bus/train/parking). */
  positioningCost: number;
  /** Unchecked airports stay listed in settings but aren't searched. */
  enabled?: boolean;
}

export interface AppSettings {
  homeCity: string;
  originAirports: OriginAirport[];
  flexDays: number;
  hotelMinStars: number;
  hotelMinRating10: number;
  cppFloor: number; // cents per point
  briefTime: string; // "07:00" America/New_York
  briefChannels: { push: boolean; email: boolean };
  dataTier: "free" | "paid";
  /** SerpApi monthly search allowance to budget scrapes against. Verify on your plan page. */
  serpapiMonthlyQuota: number;
  /** Share of the monthly quota the flight job may use (rest left for hotels later). */
  flightQuotaShare: number;
  /** Requests per day the free Google Flights source may make (one per airport pair). */
  freeFlightDailyRequests: number;
  cards: {
    citiStrataVersion: "unknown" | "strata" | "strata_premier" | "strata_elite";
    hasChaseSapphire: "unknown" | "yes" | "no";
    chaseFreedomVersion: "unknown" | "freedom" | "freedom_flex" | "freedom_unlimited";
  };
  status: { airline: string; hotel: string };
  /** Fee % per ticket platform, used when a site's price excludes fees (estimates; edit freely). */
  ticketFeePct: Record<string, number>;
  /** Alert when CrowdVolt's lowest ask is within this many dollars of the highest bid. */
  crowdvoltGapAlert: number;
  /** Artists to look for in newly discovered events. */
  favoriteArtists: string[];
  asiaDestination: "undecided" | "tokyo" | "china";
  nyeChoice: string; // "undecided" or trip id
}

export const DEFAULT_SETTINGS: AppSettings = {
  homeCity: "Boston",
  originAirports: [
    { code: "BOS", label: "Boston Logan", positioningCost: 0 },
    { code: "PVD", label: "Providence", positioningCost: 30 },
    { code: "MHT", label: "Manchester NH", positioningCost: 30 },
    { code: "JFK", label: "New York JFK", positioningCost: 60 },
    { code: "EWR", label: "Newark", positioningCost: 60 },
    { code: "LGA", label: "New York LaGuardia", positioningCost: 60 },
  ],
  flexDays: 2,
  hotelMinStars: 3,
  hotelMinRating10: 8.0,
  cppFloor: 1.5,
  briefTime: "07:00",
  briefChannels: { push: true, email: true },
  dataTier: "free",
  serpapiMonthlyQuota: 250,
  flightQuotaShare: 0.6,
  freeFlightDailyRequests: 120,
  cards: { citiStrataVersion: "unknown", hasChaseSapphire: "unknown", chaseFreedomVersion: "unknown" },
  status: { airline: "", hotel: "" },
  ticketFeePct: {},
  crowdvoltGapAlert: 20,
  favoriteArtists: [
    "Subtronics", "Excision", "Wooli", "Tape B", "Dabin", "Zeds Dead", "Knock2", "RL Grime", "Chris Lake",
    "Tiësto", "John Summit", "Fisher", "Kaskade", "Marshmello", "DJ Snake", "Seven Lions", "Illenium", "Griz", "Slander", "Levity", "ISOxo",
  ],
  asiaDestination: "undecided",
  nyeChoice: "undecided",
};

export function mergeSettings(rows: { key: string; value: unknown }[]): AppSettings {
  const s: Record<string, unknown> = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
  for (const r of rows) if (r.key in s) s[r.key] = r.value;
  return s as unknown as AppSettings;
}

export function searchOrigins(settings: AppSettings): string[] {
  return settings.originAirports.filter((a) => a.enabled !== false).map((a) => a.code);
}

export function positioningCostFor(settings: AppSettings, airport: string): number {
  return settings.originAirports.find((a) => a.code === airport)?.positioningCost ?? 0;
}

export interface SetupItem {
  id: string;
  question: string;
  done: boolean;
  href: string;
}

/** Spec §15 open questions, as a checklist. */
export function setupChecklist(
  s: AppSettings,
  ctx: { pointsUpdated: boolean; keys: Record<string, boolean> },
): SetupItem[] {
  return [
    {
      id: "cards",
      question: "Which Citi Strata version? Any Chase Sapphire? Which Chase Freedom?",
      done:
        s.cards.citiStrataVersion !== "unknown" &&
        s.cards.hasChaseSapphire !== "unknown" &&
        s.cards.chaseFreedomVersion !== "unknown",
      href: "/settings#cards",
    },
    { id: "points", question: "Enter current points balances (Amex MR, Citi TYP, Chase UR)", done: ctx.pointsUpdated, href: "/settings#points" },
    { id: "status", question: "Any airline or hotel status?", done: !!(s.status.airline || s.status.hotel), href: "/settings#status" },
    { id: "brief", question: "Daily brief time and channels", done: true, href: "/settings#brief" },
    { id: "asia", question: "Asia destination: Tokyo or a city in China?", done: s.asiaDestination !== "undecided", href: "/compare" },
    { id: "nye", question: "NYE choice: HiJinx or an alternative?", done: s.nyeChoice !== "undecided", href: "/compare" },
    { id: "serpapi", question: "Add a free SerpApi key for hotel prices (flights already use the free source)", done: !!ctx.keys.SERPAPI_KEY, href: "/setup" },
  ];
}
