import type { PrismaClient, Prisma } from "@rave-run/db";
import type { QueryCacheStore } from "@rave-run/providers";

/** Postgres-backed 6-hour query cache (spec §5). */
export function pgQueryCache(prisma: PrismaClient): QueryCacheStore {
  return {
    async get(key, maxAgeMs) {
      const row = await prisma.queryCache.findUnique({ where: { key } });
      if (!row || Date.now() - row.fetchedAt.getTime() > maxAgeMs) return null;
      return { response: row.response, fetchedAt: row.fetchedAt };
    },
    async set(key, provider, response) {
      const data = { provider, response: response as Prisma.InputJsonValue, fetchedAt: new Date() };
      await prisma.queryCache.upsert({ where: { key }, create: { key, ...data }, update: data });
    },
  };
}
