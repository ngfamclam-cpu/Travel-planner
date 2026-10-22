// Spec §14: never silently reuse numbers older than 48 hours.

export const STALE_AFTER_HOURS = 48;

export function ageHours(fetchedAt: Date, now = new Date()): number {
  return (now.getTime() - fetchedAt.getTime()) / 3_600_000;
}

export function isStale(fetchedAt: Date | null | undefined, now = new Date(), maxHours = STALE_AFTER_HOURS): boolean {
  return !fetchedAt || ageHours(fetchedAt, now) > maxHours;
}

export function relativeAge(fetchedAt: Date, now = new Date()): string {
  const h = ageHours(fetchedAt, now);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
