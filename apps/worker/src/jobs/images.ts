// Festival and ticket-site images: each site's preview image and icon, saved to `media` and
// served by the app. Monthly per event; right away for events that just got an official site.
import { TICKET_PLATFORMS, todayIn } from "@rave-run/core";
import type { PrismaClient } from "@rave-run/db";
import type { FetchedImage } from "@rave-run/providers";

export interface ImageDeps {
  pageImageUrls: (pageUrl: string) => Promise<{ hero: string | null; icon: string | null }>;
  fetchImage: (url: string, maxBytes: number) => Promise<FetchedImage>;
  pauseMs?: number;
}

const MONTH_MS = 30 * 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function store(prisma: PrismaClient, key: string, img: FetchedImage): Promise<string> {
  const data = { sourceUrl: img.url, contentType: img.contentType, data: new Uint8Array(img.data), fetchedAt: new Date() };
  const row = await prisma.media.upsert({ where: { key }, create: { key, ...data }, update: data });
  return row.id;
}

export async function runImages(prisma: PrismaClient, deps: ImageDeps, opts: { now?: Date; onlyNew?: boolean; limit?: number; log?: (m: string) => void } = {}) {
  const now = opts.now ?? new Date();
  const log = opts.log ?? console.log;
  const today = new Date(`${todayIn("America/New_York", now)}T00:00:00Z`);
  const events = await prisma.event.findMany({
    where: {
      endDate: { gte: today },
      OR: [{ officialUrl: { not: null } }, { edmtrainUrl: { not: null } }, { ticketUrl: { not: null } }],
      ...(opts.onlyNew ? { imagesCheckedAt: null } : {}),
    },
    orderBy: { startDate: "asc" },
  });
  const due = events
    .filter((e) => e.officialUrl || e.edmtrainUrl || e.ticketUrl)
    .filter((e) => !e.imagesCheckedAt || now.getTime() - e.imagesCheckedAt.getTime() >= MONTH_MS)
    .slice(0, opts.limit ?? 30);

  let found = 0;
  const failures: string[] = [];
  for (const [i, e] of due.entries()) {
    const page = (e.officialUrl ?? e.edmtrainUrl ?? e.ticketUrl)!;
    let heroId: string | null = e.heroMediaId;
    let iconId: string | null = e.iconMediaId;
    try {
      const urls = await deps.pageImageUrls(page);
      if (urls.hero) {
        try {
          heroId = await store(prisma, `event-${e.id}-hero`, await deps.fetchImage(urls.hero, 3_000_000));
          found++;
        } catch (err) {
          failures.push(`${e.name} image: ${(err as Error).message}`);
        }
      }
      if (urls.icon) {
        try {
          iconId = await store(prisma, `event-${e.id}-icon`, await deps.fetchImage(urls.icon, 300_000));
        } catch {
          /* icons are optional */
        }
      }
    } catch (err) {
      failures.push(`${e.name}: ${(err as Error).message}`);
    }
    await prisma.event.update({ where: { id: e.id }, data: { heroMediaId: heroId, iconMediaId: iconId, imagesCheckedAt: now } });
    if (deps.pauseMs && i < due.length - 1) await sleep(deps.pauseMs);
  }

  // Ticket platform logos (once every couple of months).
  if (!opts.onlyNew) {
    for (const p of Object.values(TICKET_PLATFORMS)) {
      if (!p.domain) continue;
      const key = `platform-${p.id}-icon`;
      const have = await prisma.media.findUnique({ where: { key }, select: { fetchedAt: true } });
      if (have && now.getTime() - have.fetchedAt.getTime() < 2 * MONTH_MS) continue;
      try {
        const urls = await deps.pageImageUrls(`https://${p.domain.split("/")[0]}`);
        if (urls.icon) await store(prisma, key, await deps.fetchImage(urls.icon, 300_000));
      } catch (err) {
        failures.push(`${p.name} logo: ${(err as Error).message}`);
      }
    }
  }

  if (due.length || failures.length) {
    await prisma.providerRun.create({ data: { provider: "site images", kind: "images", ok: found > 0 || failures.length === 0, queries: due.length, results: found, error: failures.length ? failures.slice(0, 8).join("\n") : null } });
  }
  log(`Images: ${found} event images from ${due.length} sites${failures.length ? `, ${failures.length} failed` : ""}`);
  return { checked: due.length, found, failures };
}
