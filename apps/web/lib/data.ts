// Server-side data access. Converts Prisma Decimals/Dates into plain values for rendering.
import {
  addDays,
  computeSurge,
  defaultHotelLocation,
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
  type HotelBooking,
  type HotelSearchSpec,
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
      snapshots: { where: { isBaseline: false }, orderBy: { fetchedAt: "asc" as const }, take: 600 },
    },
  },
} satisfies Prisma.TripInclude;

type TripRow = Prisma.TripGetPayload<{ include: typeof tripInclude }>;

export interface SparkPoint {
  date: string;
  price: number;
}

export interface HotelOption {
  name: string;
  total: number;
  perNight: number;
  stars: number | null;
  rating5: number | null;
  refundable: boolean | null;
  url: string | null;
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
  hotel: { location: string | null; customLocation: string | null; booking: HotelBooking | null; options: HotelOption[] } | null;
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

type SnapRow = TripRow["lineItems"][number]["snapshots"][number];

/** Snapshots priced for this trip's current dates (exact nights for hotels, ±flex for flights). */
function matchesDates(s: SnapRow, kind: string, arrive: string, depart: string, flex: number): boolean {
  if (!s.outboundDate || !s.returnDate) return true;
  const o = toISODate(s.outboundDate);
  const r = toISODate(s.returnDate);
  if (kind === "hotel") return o === arrive && r === depart;
  return o >= addDays(arrive, -flex) && o <= addDays(arrive, flex) && r >= addDays(depart, -flex) && r <= addDays(depart, flex);
}

function toView(t: TripRow, all: TripLike[]): TripView {
  const arrive = toISODate(t.arriveDate);
  const depart = toISODate(t.departDate);
  const items: LineItemView[] = t.lineItems.map((li) => {
    const quoted = num(li.quotedAmount);
    const snaps = li.snapshots.filter((s) => matchesDates(s, li.kind, arrive, depart, t.flexDays));
    const latest = snaps.at(-1);
    const hotelSpec = li.kind === "hotel" ? ((li.searchSpec ?? {}) as HotelSearchSpec) : null;
    // Options from the most recent hotel fetch, cheapest first.
    const batch = latest && li.kind === "hotel" ? snaps.filter((s) => s.fetchedAt.getTime() === latest.fetchedAt.getTime()) : [];
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
      searchSpec: li.kind === "flight" ? (li.searchSpec as FlightSearchSpec | null) : null,
      hotel: hotelSpec
        ? {
            location: hotelSpec.query || defaultHotelLocation(t.event),
            customLocation: hotelSpec.query ?? null,
            booking: (li.booking as HotelBooking | null) ?? null,
            options: batch
              .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
              .map((s) => ({
                name: s.hotelName ?? "hotel",
                total: Number(s.totalPrice),
                perNight: Number(s.price),
                stars: s.stars,
                rating5: s.rating,
                refundable: s.refundable,
                url: s.bookingUrl,
              })),
          }
        : null,
      spark: sparkline(snaps),
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

export async function openAlerts(tripId?: string) {
  return prisma.alert.findMany({
    where: { dismissedAt: null, ...(tripId ? { tripId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}
