// Collect today's facts for the brief straight from the database (spec §9: no number may come from anywhere else).
import {
  bestAmount,
  diffDays,
  eventClashes,
  isStale,
  matchingArtists,
  mergeSettings,
  pickCards,
  categoryFor,
  todayIn,
  toISODate,
  tripTotals,
  type BriefPayload,
  type BriefTrip,
  type CardLike,
} from "@rave-run/core";
import type { PrismaClient } from "@rave-run/db";

const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtRange = (a: Date, b: Date) => `${fmtDay(a)} – ${fmtDay(b)}, ${b.getUTCFullYear()}`;
const num = (d: unknown) => (d == null ? null : Number(d));

export async function buildBriefPayload(prisma: PrismaClient, now = new Date()): Promise<BriefPayload> {
  const today = todayIn("America/New_York", now);
  const settings = mergeSettings(await prisma.setting.findMany());
  const dayAgo = new Date(now.getTime() - 26 * 3_600_000);

  const [trips, cardsRaw, alerts, runs, previous, events] = await Promise.all([
    prisma.trip.findMany({
      where: { status: { in: ["considering", "planned", "booked"] }, departDate: { gte: new Date(`${today}T00:00:00Z`) } },
      include: { lineItems: { orderBy: { sortOrder: "asc" } }, event: true },
      orderBy: { arriveDate: "asc" },
    }),
    prisma.card.findMany(),
    prisma.alert.findMany({ where: { dismissedAt: null, createdAt: { gte: dayAgo } }, orderBy: { createdAt: "desc" } }),
    prisma.providerRun.findMany({ where: { startedAt: { gte: dayAgo } }, orderBy: { startedAt: "desc" } }),
    prisma.brief.findFirst({ where: { date: { lt: new Date(`${today}T00:00:00Z`) } }, orderBy: { date: "desc" } }),
    prisma.event.findMany({ where: { createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) }, source: { in: ["edmtrain", "ticketmaster"] } }, orderBy: { startDate: "asc" } }),
  ]);
  const cards: CardLike[] = cardsRaw.map((c) => ({
    id: c.id, name: c.name, foreignFeePct: num(c.foreignFeePct), pointsCurrency: c.pointsCurrency, earnRules: (c.earnRules ?? {}) as Record<string, unknown>, needsSetup: c.needsSetup,
  }));
  const valueOf = (cur: string | null) => settings.pointValues[cur ?? "cash back"] ?? 1;
  const prevTotals = new Map(((previous?.payload as BriefPayload | null)?.trips ?? []).map((t) => [t.url, t.total]));

  const committed = trips.filter((t) => t.status === "planned" || t.status === "booked");
  const briefTrips: BriefTrip[] = committed.map((t) => {
    const abroad = (t.event?.country ?? "US") !== "US";
    const amounts = t.lineItems.map((li) => ({ estAmount: num(li.estAmount), quotedAmount: num(li.quotedAmount), bookedAmount: num(li.bookedAmount), qty: li.qty, included: li.included }));
    const totals = tripTotals(amounts);
    const url = `/trips/${t.id}`;
    const items = t.lineItems
      .filter((li) => li.included)
      .map((li) => {
        const { unit, state } = bestAmount(amounts[t.lineItems.indexOf(li)]);
        const stale = state === "quoted" && isStale(li.quotedAt, now);
        const card = li.bookedAmount == null && unit != null && cards.length ? pickCards(cards, categoryFor(li.kind), { abroad, amount: (unit ?? 0) * li.qty, valueOf })[0] : null;
        return {
          kind: li.kind,
          label: li.label,
          amount: unit == null ? null : Math.round(unit * li.qty),
          state,
          signal: li.signal && li.signal !== "DONE" ? li.signal : null,
          reason: li.signal && li.signal !== "DONE" ? li.signalReason : null,
          card: card ? `${card.name}: ${card.reason}` : null,
          lastChecked: stale ? (li.quotedAt ? fmtDay(li.quotedAt) : li.quotedSource ?? "unknown") : null,
        } as BriefTrip["items"][number];
      });
    const total = Math.round(totals.total);
    const prev = prevTotals.get(url);
    return {
      name: t.name,
      status: t.status,
      dates: fmtRange(t.arriveDate, t.departDate),
      daysAway: diffDays(today, toISODate(t.arriveDate)),
      total,
      change: prev == null ? null : total - prev,
      notPriced: totals.unpricedCount,
      buyNow: items.filter((i) => i.signal === "BUY_NOW").length,
      items,
      url,
    };
  });

  // Action items: new alerts, plus anything on a planned trip that says BUY NOW.
  const actions: BriefPayload["actions"] = alerts.map((a) => ({ kind: a.kind, title: a.title, detail: a.body, url: a.url }));
  for (const t of briefTrips) {
    for (const i of t.items) {
      if (i.signal === "BUY_NOW" && !actions.some((a) => a.title.includes(t.name) && a.title.includes(i.label))) {
        actions.push({ kind: "buy_now", title: `${t.name}: buy ${i.kind} (${i.label})`, detail: i.reason ?? "", url: null });
      }
    }
  }

  // Options still being compared, cheapest fully-totalled one per group.
  const considering = new Map<string, { options: number; cheapest: { name: string; total: number } | null }>();
  for (const t of trips.filter((x) => x.status === "considering")) {
    const g = t.slot ?? "Other ideas";
    const tt = tripTotals(t.lineItems.map((li) => ({ estAmount: num(li.estAmount), quotedAmount: num(li.quotedAmount), bookedAmount: num(li.bookedAmount), qty: li.qty, included: li.included })));
    const total = Math.round(tt.total);
    const cur = considering.get(g) ?? { options: 0, cheapest: null };
    cur.options++;
    // Only fully priced options can be "cheapest"; a half-priced one just looks cheap.
    if (tt.unpricedCount === 0 && total > 0 && (!cur.cheapest || total < cur.cheapest.total)) cur.cheapest = { name: t.name, total };
    considering.set(g, cur);
  }

  const tripLikes = trips.map((t) => ({ id: t.id, name: t.name, status: t.status, arrive: toISODate(t.arriveDate), depart: toISODate(t.departDate) }));
  const newEvents = events.map((e) => ({
    name: e.name,
    city: e.city,
    dates: fmtRange(e.startDate, e.endDate),
    artists: matchingArtists(e.lineupHighlights, settings.favoriteArtists),
    clashesWith: eventClashes({ start: toISODate(e.startDate), end: toISODate(e.endDate) }, tripLikes).map((t) => t.name),
    url: e.edmtrainUrl ?? e.ticketUrl ?? e.officialUrl,
  }));

  // "Couldn't check" notes: the latest run per source kind that failed.
  const seen = new Set<string>();
  const problems: BriefPayload["problems"] = [];
  for (const r of runs) {
    const key = `${r.kind}:${r.provider}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!r.ok) problems.push({ source: `${r.kind} prices (${r.provider})`, note: (r.error ?? "failed").split("\n")[0].slice(0, 160) });
  }
  for (const kind of ["flight", "hotel"]) {
    if (!runs.some((r) => r.kind === kind)) problems.push({ source: `${kind} prices`, note: "not checked in the last day" });
  }

  return {
    date: today,
    dateLabel: new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }),
    counts: {
      actions: actions.length,
      plannedTrips: briefTrips.length,
      buyNow: briefTrips.reduce((s, t) => s + t.buyNow, 0),
      newEvents: newEvents.length,
      problems: problems.length,
    },
    actions,
    trips: briefTrips,
    considering: [...considering.entries()].map(([group, v]) => ({ group, ...v })),
    newEvents,
    problems,
    savings: null,
  };
}
