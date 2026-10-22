// Server-side data access. Converts Prisma Decimals/Dates into plain values for rendering.
import {
  computeSurge,
  destinationFromAirports,
  findClashes,
  isStale,
  mergeSettings,
  nights,
  seasonalTraps,
  toISODate,
  tripTotals,
  type AppSettings,
  type Clash,
  type FlightSearchSpec,
  type SeasonalTrap,
  type Surge,
  type TripLike,
  type TripTotals,
} from "@rave-run/core";
import { prisma, type Prisma } from "@rave-run/db";

const num = (d: Prisma.Decimal | null | undefined) => (d == null ? null : Number(d));

export async function getSettings(): Promise<AppSettings> {
  return mergeSettings(await prisma.setting.findMany());
}

const tripInclude = {
  event: true,
  lineItems: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: {
      card: true,
      snapshots: { where: { isBaseline: false }, orderBy: { fetchedAt: "asc" as const }, take: 400 },
    },
  },
} satisfies Prisma.TripInclude;

type TripRow = Prisma.TripGetPayload<{ include: typeof tripInclude }>;

export interface SparkPoint {
  date: string;
  price: number;
}

export interface LineItemView {
  id: string;
  kind: string;
  label: string;
  qty: number;
  estAmount: number | null;
  quotedAmount: number | null;
  bookedAmount: number | null;
  quotedSource: string | null;
  quotedAt: Date | null;
  quotedUrl: string | null;
  quoteStale: boolean;
  insightLabel: string | null;
  baselinePrice: number | null;
  surge: Surge | null;
  notes: string | null;
  cardName: string | null;
  searchSpec: FlightSearchSpec | null;
  spark: SparkPoint[];
  latestSnapshot: { origin: string | null; carrier: string | null; stops: number | null; variant: string | null; fetchedAt: Date } | null;
}

export interface TripView {
  id: string;
  name: string;
  status: TripLike["status"];
  slot: string | null;
  color: string;
  arrive: string;
  depart: string;
  nights: number;
  flexDays: number;
  notes: string | null;
  event: { id: string; name: string; city: string; country: string; venue: string | null; start: string; end: string; lineup: string[]; officialUrl: string | null; ticketUrl: string | null; notes: string | null } | null;
  items: LineItemView[];
  totals: TripTotals;
  traps: SeasonalTrap[];
  clashes: Clash[];
}

/** Cheapest snapshot per fetch day, for the sparkline. */
function sparkline(snaps: TripRow["lineItems"][number]["snapshots"]): SparkPoint[] {
  const byDay = new Map<string, number>();
  for (const s of snaps) {
    const d = toISODate(s.fetchedAt);
    const p = Number(s.totalPrice);
    byDay.set(d, Math.min(byDay.get(d) ?? Infinity, p));
  }
  return [...byDay.entries()].map(([date, price]) => ({ date, price }));
}

function toView(t: TripRow, all: TripLike[]): TripView {
  const arrive = toISODate(t.arriveDate);
  const depart = toISODate(t.departDate);
  const items: LineItemView[] = t.lineItems.map((li) => {
    const quoted = num(li.quotedAmount);
    const latest = li.snapshots.at(-1);
    return {
      id: li.id,
      kind: li.kind,
      label: li.label,
      qty: li.qty,
      estAmount: num(li.estAmount),
      quotedAmount: quoted,
      bookedAmount: num(li.bookedAmount),
      quotedSource: li.quotedSource,
      quotedAt: li.quotedAt,
      quotedUrl: li.quotedUrl,
      // Seed quotes without a timestamp count as stale too: they need a fresh check.
      quoteStale: quoted != null && isStale(li.quotedAt),
      insightLabel: li.insightLabel,
      baselinePrice: num(li.baselinePrice),
      surge: computeSurge(quoted, num(li.baselinePrice)),
      notes: li.notes,
      cardName: li.card?.name ?? null,
      searchSpec: li.searchSpec as FlightSearchSpec | null,
      spark: sparkline(li.snapshots),
      latestSnapshot: latest
        ? { origin: latest.origin, carrier: latest.carrier, stops: latest.stops, variant: latest.variant, fetchedAt: latest.fetchedAt }
        : null,
    };
  });
  const airports = items.flatMap((i) => i.searchSpec?.destinations ?? []);
  const dest = t.event ? { country: t.event.country, city: t.event.city, airports } : destinationFromAirports(airports);
  const self: TripLike = { id: t.id, name: t.name, status: t.status, arrive, depart, slot: t.slot };
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    slot: t.slot,
    color: t.color,
    arrive,
    depart,
    nights: nights({ arrive, depart }),
    flexDays: t.flexDays,
    notes: t.notes,
    event: t.event
      ? {
          id: t.event.id,
          name: t.event.name,
          city: t.event.city,
          country: t.event.country,
          venue: t.event.venue,
          start: toISODate(t.event.startDate),
          end: toISODate(t.event.endDate),
          lineup: t.event.lineupHighlights,
          officialUrl: t.event.officialUrl,
          ticketUrl: t.event.ticketUrl,
          notes: t.event.notes,
        }
      : null,
    items,
    totals: tripTotals(items),
    traps: seasonalTraps({ start: arrive, end: depart }, dest),
    clashes: findClashes(self, all),
  };
}

export async function listTrips(): Promise<TripView[]> {
  const rows = await prisma.trip.findMany({ include: tripInclude, orderBy: [{ arriveDate: "asc" }] });
  const all: TripLike[] = rows.map((t) => ({ id: t.id, name: t.name, status: t.status, arrive: toISODate(t.arriveDate), depart: toISODate(t.departDate), slot: t.slot }));
  return rows.map((t) => toView(t, all));
}

export async function getTrip(id: string): Promise<TripView | null> {
  const trips = await listTrips();
  return trips.find((t) => t.id === id) ?? null;
}

/** Latest run per provider in the last 48h, for "couldn't check" notes (spec §9, §14). */
export async function providerHealth() {
  const since = new Date(Date.now() - 48 * 3_600_000);
  const runs = await prisma.providerRun.findMany({ where: { startedAt: { gte: since } }, orderBy: { startedAt: "desc" } });
  const latest = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!latest.has(r.kind)) latest.set(r.kind, r);
  return [...latest.values()];
}

export async function listEvents() {
  return prisma.event.findMany({ orderBy: { startDate: "asc" }, include: { trips: { select: { id: true } } } });
}

export async function getCards() {
  return prisma.card.findMany({ orderBy: { name: "asc" } });
}

export async function getPoints() {
  return prisma.pointsBalance.findMany({ orderBy: { currency: "asc" } });
}
