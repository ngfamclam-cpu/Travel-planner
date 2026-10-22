// Seasonal traps (spec §3): flag windows that are known peak / surge periods.
import { addDays, parseISODate, rangesOverlap, toISODate, type DateRange, type ISODate } from "./dates";

export interface Destination {
  country: string; // ISO-ish: "US", "JP", "TH", "CN", "KR", "TW"
  city?: string;
  airports?: string[];
}

export interface SeasonalTrap {
  id: string;
  name: string;
  note: string;
  range: DateRange;
}

interface TrapRule {
  id: string;
  name: string;
  note: string;
  ranges: (year: number) => DateRange[];
  applies: (d: Destination) => boolean;
}

const FLORIDA_AIRPORTS = ["MIA", "FLL", "MCO", "TPA", "PBI", "RSW", "JAX"];
const FLORIDA_CITIES = ["miami", "orlando", "tampa", "fort lauderdale", "miami beach", "west palm beach"];

const md = (year: number, m: number, d: number): ISODate =>
  `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** nth weekday (0=Sun) of a month; n = -1 for last. */
function nthWeekday(year: number, month: number, weekday: number, n: number): ISODate {
  if (n > 0) {
    const first = parseISODate(md(year, month, 1)).getUTCDay();
    return md(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(year, month, 0));
  const back = (lastDay.getUTCDay() - weekday + 7) % 7;
  return toISODate(new Date(lastDay.getTime() - back * 86_400_000));
}

// Lunar New Year day (first day). Extend as needed.
const LUNAR_NEW_YEAR: Record<number, ISODate> = {
  2026: "2026-02-17",
  2027: "2027-02-06",
  2028: "2028-01-26",
};

const isUS = (d: Destination) => d.country === "US";
const isFlorida = (d: Destination) =>
  isUS(d) &&
  ((d.airports ?? []).some((a) => FLORIDA_AIRPORTS.includes(a)) ||
    FLORIDA_CITIES.includes((d.city ?? "").toLowerCase()));

const RULES: TrapRule[] = [
  {
    id: "nye",
    name: "New Year's week",
    note: "Holiday week: flights and hotels peak; book early.",
    ranges: (y) => [{ start: md(y, 12, 26), end: md(y + 1, 1, 2) }],
    applies: () => true,
  },
  {
    id: "thanksgiving",
    name: "Thanksgiving",
    note: "Busiest US travel days of the year.",
    ranges: (y) => {
      const thu = nthWeekday(y, 11, 4, 4);
      return [{ start: addDays(thu, -2), end: addDays(thu, 3) }];
    },
    applies: isUS,
  },
  {
    id: "memorial-day",
    name: "Memorial Day weekend",
    note: "US holiday weekend.",
    ranges: (y) => {
      const mon = nthWeekday(y, 5, 1, -1);
      return [{ start: addDays(mon, -3), end: mon }];
    },
    applies: isUS,
  },
  {
    id: "july-4",
    name: "July 4th",
    note: "US holiday.",
    ranges: (y) => [{ start: md(y, 7, 1), end: md(y, 7, 6) }],
    applies: isUS,
  },
  {
    id: "labor-day",
    name: "Labor Day weekend",
    note: "US holiday weekend.",
    ranges: (y) => {
      const mon = nthWeekday(y, 9, 1, 1);
      return [{ start: addDays(mon, -3), end: mon }];
    },
    applies: isUS,
  },
  {
    id: "spring-break-fl",
    name: "Florida spring break",
    note: "Mid-March to early April: Florida hotels and flights surge.",
    ranges: (y) => [{ start: md(y, 3, 10), end: md(y, 4, 10) }],
    applies: isFlorida,
  },
  {
    id: "cherry-blossom",
    name: "Cherry blossom season",
    note: "Late March–early April in Japan: hotels fill and prices jump.",
    ranges: (y) => [{ start: md(y, 3, 20), end: md(y, 4, 10) }],
    applies: (d) => d.country === "JP",
  },
  {
    id: "golden-week",
    name: "Golden Week",
    note: "Japan's biggest domestic travel week.",
    ranges: (y) => [{ start: md(y, 4, 29), end: md(y, 5, 6) }],
    applies: (d) => d.country === "JP",
  },
  {
    id: "songkran",
    name: "Songkran",
    note: "Mid-April Thai New Year: Bangkok flights and hotels peak.",
    ranges: (y) => [{ start: md(y, 4, 11), end: md(y, 4, 17) }],
    applies: (d) => d.country === "TH",
  },
  {
    id: "lunar-new-year",
    name: "Lunar New Year",
    note: "Huge travel surge across China, Taiwan and Korea.",
    ranges: (y) => {
      const day = LUNAR_NEW_YEAR[y];
      return day ? [{ start: addDays(day, -7), end: addDays(day, 7) }] : [];
    },
    applies: (d) => ["CN", "TW", "KR", "HK", "SG"].includes(d.country),
  },
  {
    id: "china-golden-week",
    name: "China National Day Golden Week",
    note: "Oct 1–7: domestic travel peak in China.",
    ranges: (y) => [{ start: md(y, 10, 1), end: md(y, 10, 7) }],
    applies: (d) => d.country === "CN",
  },
];

export function seasonalTraps(window: DateRange, dest: Destination): SeasonalTrap[] {
  const years = new Set([
    parseISODate(window.start).getUTCFullYear() - 1,
    parseISODate(window.start).getUTCFullYear(),
    parseISODate(window.end).getUTCFullYear(),
  ]);
  const hits: SeasonalTrap[] = [];
  for (const rule of RULES) {
    if (!rule.applies(dest)) continue;
    for (const y of years) {
      for (const range of rule.ranges(y)) {
        if (rangesOverlap(window, range) && !hits.some((h) => h.id === rule.id)) {
          hits.push({ id: rule.id, name: rule.name, note: rule.note, range });
        }
      }
    }
  }
  return hits;
}

export function isPeakWindow(window: DateRange, dest: Destination): boolean {
  return seasonalTraps(window, dest).length > 0;
}

const AIRPORT_COUNTRY: Record<string, string> = {
  HND: "JP", NRT: "JP", KIX: "JP", ITM: "JP",
  BKK: "TH", DMK: "TH",
  ICN: "KR", GMP: "KR",
  TPE: "TW", TSA: "TW",
  PVG: "CN", PEK: "CN", PKX: "CN", CAN: "CN", SZX: "CN", ZUH: "CN",
  HKG: "HK", SIN: "SG",
};

/** Best-effort destination for seasonal checks when a trip has no event attached. */
export function destinationFromAirports(airports: string[]): Destination {
  const country = airports.map((a) => AIRPORT_COUNTRY[a]).find(Boolean) ?? "US";
  return { country, airports };
}
