// Spec §14: adding an event automatically creates a trip with arrive = start − 1, depart = end + 1.
import type { LineItemKind, Prisma, PrismaClient, TripStatus } from "@prisma/client";
import { eventWindow, nights, toISODate } from "@rave-run/core";

export const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

export interface NewLineItem {
  kind: LineItemKind;
  label: string;
  estAmount?: number | null;
  quotedAmount?: number | null;
  qty?: number;
  quotedSource?: string;
  quotedAt?: Date | null;
  quotedUrl?: string;
  insightLabel?: string;
  searchSpec?: Prisma.InputJsonValue;
  notes?: string;
}

export interface CreateTripOptions {
  name?: string;
  status?: TripStatus;
  slot?: string;
  color?: string;
  flexDays?: number;
  arrive?: string; // override the event window
  depart?: string;
  notes?: string;
  /** Replace the default line items. */
  items?: NewLineItem[];
}

const PALETTE = ["#a855f7", "#ec4899", "#22d3ee", "#facc15", "#4ade80", "#f97316", "#60a5fa", "#f43f5e"];

/** Default line items for an event trip: flight (if it has airports), hotel for the window's nights, ticket. */
export function defaultLineItems(event: { name: string; airports: string[] }, nightsCount: number): NewLineItem[] {
  const items: NewLineItem[] = [];
  if (event.airports.length) {
    items.push({
      kind: "flight",
      label: `Flight BOS area → ${event.airports.join("/")}`,
      searchSpec: { destinations: event.airports },
      notes: "Not priced yet: the next worker run searches the event-window dates.",
    });
  }
  items.push({ kind: "hotel", label: `Hotel, ${nightsCount} night${nightsCount === 1 ? "" : "s"}`, qty: nightsCount });
  items.push({ kind: "ticket", label: `${event.name} ticket` });
  items.push({ kind: "ground", label: "Airport/venue transport" });
  return items;
}

export async function createTripFromEvent(prisma: PrismaClient, eventId: string, opts: CreateTripOptions = {}) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const win = eventWindow(toISODate(event.startDate), toISODate(event.endDate));
  const arrive = opts.arrive ?? win.arrive;
  const depart = opts.depart ?? win.depart;
  const n = nights({ arrive, depart });
  const tripCount = await prisma.trip.count();
  const items = opts.items ?? defaultLineItems(event, n);

  return prisma.trip.create({
    data: {
      name: opts.name ?? event.name,
      eventId,
      status: opts.status ?? "considering",
      slot: opts.slot,
      color: opts.color ?? PALETTE[tripCount % PALETTE.length],
      arriveDate: day(arrive),
      departDate: day(depart),
      flexDays: opts.flexDays ?? 2,
      notes: opts.notes,
      lineItems: {
        create: items.map((li, i) => ({
          kind: li.kind,
          label: li.label,
          estAmount: li.estAmount ?? null,
          quotedAmount: li.quotedAmount ?? null,
          qty: li.qty ?? 1,
          isEstimate: li.quotedAmount == null,
          quotedSource: li.quotedSource,
          quotedAt: li.quotedAt ?? null,
          quotedUrl: li.quotedUrl,
          insightLabel: li.insightLabel,
          searchSpec: li.searchSpec,
          notes: li.notes,
          sortOrder: i,
        })),
      },
    },
    include: { lineItems: true },
  });
}
