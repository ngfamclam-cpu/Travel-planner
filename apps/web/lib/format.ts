import { formatUSD, parseISODate, relativeAge } from "@rave-run/core";

export const usd = (n: number | null | undefined, cents = false) => formatUSD(n, { cents });

export function fmtDay(iso: string, withYear = false): string {
  return parseISODate(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

export function fmtRange(a: string, b: string): string {
  const y = parseISODate(b).getUTCFullYear();
  return `${fmtDay(a)} – ${fmtDay(b)} ${y}`;
}

export function fmtWhen(d: Date | null | undefined): string {
  if (!d) return "time unknown";
  const abs = d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  return `${abs} ET (${relativeAge(d)})`;
}
