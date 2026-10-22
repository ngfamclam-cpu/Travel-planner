// Ticket tracker helpers shared by the worker and the web app.
import type { Prisma, PrismaClient, TicketWatch } from "@prisma/client";
import { allInPrice, defaultTicketPlatforms, feePctFor, TICKET_PLATFORMS, type TicketPlatformId } from "@rave-run/core";

/** Make sure an event has a watch row for each default platform (NYC events also get CrowdVolt). */
export async function ensureTicketWatches(prisma: PrismaClient, eventId: string): Promise<TicketWatch[]> {
  const ev = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  for (const platform of defaultTicketPlatforms(ev)) {
    const p = TICKET_PLATFORMS[platform];
    await prisma.ticketWatch.upsert({
      where: { eventId_platform: { eventId, platform } },
      create: { eventId, platform, status: p.access === "manual" ? "manual" : "needs_link" },
      update: {},
    });
  }
  return prisma.ticketWatch.findMany({ where: { eventId } });
}

export interface RecordPriceInput {
  listed: number;
  feesIncluded: boolean;
  highestBid?: number | null;
  tierLabel?: string | null;
  source: "api" | "page" | "manual";
  url?: string | null;
  note?: string | null;
  observedAt?: Date;
  raw?: unknown;
}

/** Store one observed price, converted to all-in with the platform's fee estimate. */
export async function recordTicketPrice(
  prisma: PrismaClient,
  watch: Pick<TicketWatch, "id" | "eventId" | "platform">,
  input: RecordPriceInput,
  feeOverrides: Record<string, number> = {},
) {
  const platform = watch.platform as TicketPlatformId;
  const { allIn, feesEstimated } = allInPrice(input.listed, input.feesIncluded, feePctFor(platform, feeOverrides));
  return prisma.ticketPrice.create({
    data: {
      watchId: watch.id,
      eventId: watch.eventId,
      platform,
      listedPrice: input.listed,
      allInPrice: allIn,
      feesIncluded: input.feesIncluded,
      feesEstimated,
      highestBid: input.highestBid ?? null,
      tierLabel: input.tierLabel ?? null,
      source: input.source,
      risky: TICKET_PLATFORMS[platform]?.risky ?? false,
      url: input.url ?? null,
      note: input.note ?? null,
      observedAt: input.observedAt ?? new Date(),
      raw: (input.raw ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
