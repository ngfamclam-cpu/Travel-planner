// Keeps the database small on a modest droplet: prices stay forever (history),
// but bulky raw provider payloads, the query cache and old run logs are trimmed.
import { Prisma, type PrismaClient } from "@rave-run/db";

export interface PruneOptions {
  now?: Date;
  /** Keep full raw payloads this long (for auditing recent prices). */
  rawDays?: number;
  runLogDays?: number;
  dismissedAlertDays?: number;
}

export async function runPrune(prisma: PrismaClient, opts: PruneOptions = {}) {
  const now = opts.now ?? new Date();
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const rawBefore = ago(opts.rawDays ?? 14);
  const [snapshots, tickets, cache, runs, alerts] = await Promise.all([
    prisma.priceSnapshot.updateMany({ where: { fetchedAt: { lt: rawBefore }, NOT: { raw: { equals: Prisma.DbNull } } }, data: { raw: Prisma.DbNull } }),
    prisma.ticketPrice.updateMany({ where: { observedAt: { lt: rawBefore }, NOT: { raw: { equals: Prisma.DbNull } } }, data: { raw: Prisma.DbNull } }),
    prisma.queryCache.deleteMany({ where: { fetchedAt: { lt: ago(2) } } }),
    prisma.providerRun.deleteMany({ where: { startedAt: { lt: ago(opts.runLogDays ?? 120) } } }),
    prisma.alert.deleteMany({ where: { dismissedAt: { lt: ago(opts.dismissedAlertDays ?? 90) } } }),
  ]);
  return { snapshotsTrimmed: snapshots.count, ticketPricesTrimmed: tickets.count, cacheDeleted: cache.count, runsDeleted: runs.count, alertsDeleted: alerts.count };
}
