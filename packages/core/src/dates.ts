// Calendar-day helpers. Days are ISO strings ("2027-03-25") so they never drift with time zones.

export type ISODate = string;

const DAY_MS = 86_400_000;

export function toISODate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function parseISODate(s: ISODate): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Bad ISO date: ${s}`);
  return new Date(`${s}T00:00:00Z`);
}

export function addDays(s: ISODate, n: number): ISODate {
  return toISODate(new Date(parseISODate(s).getTime() + n * DAY_MS));
}

/** b − a in whole days. */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / DAY_MS);
}

/** Today's calendar date in the given IANA zone (defaults to America/New_York, spec §4). */
export function todayIn(timeZone = "America/New_York", now = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export interface DateRange {
  start: ISODate;
  end: ISODate; // inclusive
}

export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/** Days between the end of the earlier range and the start of the later one (negative = overlap). */
export function gapDays(a: DateRange, b: DateRange): number {
  const [first, second] = a.start <= b.start ? [a, b] : [b, a];
  return diffDays(first.end, second.start);
}

export function formatRange(r: DateRange): string {
  const fmt = (s: ISODate, withYear: boolean) =>
    parseISODate(s).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  return `${fmt(r.start, false)} – ${fmt(r.end, true)}`;
}
