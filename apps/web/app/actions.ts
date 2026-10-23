"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DEFAULT_SETTINGS, mergeSettings, nights, toISODate, type AppSettings, type HotelBooking, type HotelSearchSpec, type HotelTier } from "@rave-run/core";
import { createTripFromEvent, day, ensureTicketWatches, prisma, recordTicketPrice, refreshTripQuotes, type ChosenOption, type LineItemKind, type Prisma, type TripStatus } from "@rave-run/db";
import { TICKET_PLATFORMS, type TicketPlatformId } from "@rave-run/core";
import { SESSION_COOKIE, authConfigured, sessionToken, timingSafeEqual } from "@/lib/auth";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};
/** "" → null, "$1,234.50" → 1234.5. Throws on junk so bad input never becomes a price. */
function money(f: FormData, k: string): number | null {
  const raw = str(f, k).replace(/[$,\s]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid amount for ${k}: ${raw}`);
  return Math.round(n * 100) / 100;
}
const isoDate = (f: FormData, k: string) => {
  const v = str(f, k);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`Invalid date for ${k}`);
  return v;
};
const KINDS: LineItemKind[] = ["flight", "hotel", "ticket", "ground", "food", "other"];
const STATUSES: TripStatus[] = ["considering", "planned", "booked", "done"];

function refresh(tripId?: string) {
  revalidatePath("/");
  revalidatePath("/compare");
  if (tripId) revalidatePath(`/trips/${tripId}`);
}

// ---------- auth ----------

export async function login(_prev: string | null, f: FormData): Promise<string | null> {
  if (!authConfigured()) return "Set APP_PASSWORD and SESSION_SECRET in .env first.";
  if (!timingSafeEqual(str(f, "password"), process.env.APP_PASSWORD!)) {
    await new Promise((r) => setTimeout(r, 800));
    return "Wrong password.";
  }
  (await cookies()).set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    // Secure cookies need https; COOKIE_SECURE=0 for plain http on localhost.
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE !== "0" : process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------- line items ----------

export async function updateLineItem(f: FormData) {
  const id = str(f, "id");
  const li = await prisma.lineItem.findUniqueOrThrow({ where: { id } });
  const quoted = money(f, "quotedAmount");
  const quoteChanged = quoted !== (li.quotedAmount == null ? null : Number(li.quotedAmount));
  const qty = Math.max(0, Math.round(Number(str(f, "qty") || li.qty)));
  const cardId = str(f, "cardId");
  const booked = money(f, "bookedAmount");

  // Hotels: search area + what was booked (for rebook alerts).
  const hotelData: Prisma.LineItemUncheckedUpdateInput = {};
  if (li.kind === "hotel") {
    const query = str(f, "hotelQuery");
    const pinned = str(f, "pinnedHotel");
    const spec: HotelSearchSpec = {
      ...((li.searchSpec ?? {}) as HotelSearchSpec),
      query: query || undefined,
      pinned: pinned ? { name: pinned } : undefined,
      includeRentals: f.get("includeRentals") === "on",
    };
    hotelData.searchSpec = spec as Prisma.InputJsonValue;
    if (booked != null) {
      const optNum = (k: string) => (str(f, k) && Number.isFinite(Number(str(f, k))) ? Number(str(f, k)) : undefined);
      const cancelBy = str(f, "cancelBy");
      const booking: HotelBooking = {
        hotelName: str(f, "bookedHotelName") || undefined,
        stars: optNum("bookedStars"),
        rating5: optNum("bookedRating5"),
        refundable: f.get("bookedRefundable") === "on",
        cancelBy: /^\d{4}-\d{2}-\d{2}$/.test(cancelBy) ? cancelBy : undefined,
        confirmation: str(f, "confirmation") || undefined,
      };
      hotelData.booking = booking as Prisma.InputJsonValue;
    }
  }

  await prisma.lineItem.update({
    where: { id },
    data: {
      label: str(f, "label") || li.label,
      estAmount: money(f, "estAmount"),
      quotedAmount: quoted,
      bookedAmount: booked,
      qty,
      ...hotelData,
      notes: str(f, "notes") || null,
      cardId: cardId || null,
      // A hand-typed quote is labeled as such, with the time it was entered.
      ...(quoteChanged
        ? {
            quotedSource: quoted == null ? null : str(f, "quotedSource") || "manual entry",
            quotedAt: quoted == null ? null : new Date(),
            quotedUrl: null,
            insightLabel: null,
          }
        : {}),
      isEstimate: quoted == null && booked == null,
    },
  });
  refresh(li.tripId);
}

/** Switch an expense on or off: off = still shown, left out of every total. */
export async function toggleLineItemIncluded(f: FormData) {
  const li = await prisma.lineItem.findUniqueOrThrow({ where: { id: str(f, "id") } });
  await prisma.lineItem.update({ where: { id: li.id }, data: { included: !li.included } });
  refresh(li.tripId);
}

export async function addLineItem(f: FormData) {
  const tripId = str(f, "tripId");
  const kind = str(f, "kind") as LineItemKind;
  if (!KINDS.includes(kind)) throw new Error("Bad kind");
  const destinations = str(f, "destinations")
    .toUpperCase()
    .split(/[\s,/]+/)
    .filter((a) => /^[A-Z]{3}$/.test(a));
  const count = await prisma.lineItem.count({ where: { tripId } });
  await prisma.lineItem.create({
    data: {
      tripId,
      kind,
      label: str(f, "label") || kind,
      estAmount: money(f, "estAmount"),
      qty: Math.max(1, Number(str(f, "qty") || 1)),
      searchSpec: kind === "flight" && destinations.length ? { destinations } : undefined,
      sortOrder: count,
    },
  });
  refresh(tripId);
}

export async function deleteLineItem(f: FormData) {
  const li = await prisma.lineItem.delete({ where: { id: str(f, "id") } });
  refresh(li.tripId);
}

// ---------- trips ----------

export async function updateTrip(f: FormData) {
  const id = str(f, "id");
  const status = str(f, "status") as TripStatus;
  if (!STATUSES.includes(status)) throw new Error("Bad status");
  const arrive = isoDate(f, "arrive");
  const depart = isoDate(f, "depart");
  if (depart <= arrive) throw new Error("Depart must be after arrive");
  await syncHotelNights(id, arrive, depart);
  await prisma.trip.update({
    where: { id },
    data: {
      name: str(f, "name") || undefined,
      status,
      arriveDate: day(arrive),
      departDate: day(depart),
      flexDays: Math.min(3, Math.max(0, Number(str(f, "flexDays") || 2))),
      notes: str(f, "notes") || null,
    },
  });
  await refreshTripQuotes(prisma, id);
  refresh(id);
}

/** Hotel stays that covered the whole trip keep covering it when the dates change. */
async function syncHotelNights(tripId: string, arrive: string, depart: string) {
  const before = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
  const oldNights = nights({ arrive: toISODate(before.arriveDate), depart: toISODate(before.departDate) });
  const newNights = nights({ arrive, depart });
  if (oldNights !== newNights) {
    await prisma.lineItem.updateMany({ where: { tripId, kind: "hotel", qty: oldNights }, data: { qty: newNights } });
  }
}

const TIERS: HotelTier[] = ["cheapest", "value", "rated", "pinned", "rental"];

/** Pick a date card: the trip takes those dates and hotel pick; cards stay anchored where they were. */
export async function chooseDates(f: FormData) {
  const id = str(f, "tripId");
  const arrive = isoDate(f, "arrive");
  const depart = isoDate(f, "depart");
  if (depart <= arrive) throw new Error("Depart must be after arrive");
  const tier = str(f, "tier") as HotelTier;
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id } });
  const prev = (trip.chosenOption ?? {}) as ChosenOption;
  const chosenOption: ChosenOption = {
    anchor: prev.anchor ?? { arrive: toISODate(trip.arriveDate), depart: toISODate(trip.departDate) },
    hotelTier: TIERS.includes(tier) ? tier : prev.hotelTier ?? "cheapest",
  };
  await syncHotelNights(id, arrive, depart);
  await prisma.trip.update({
    where: { id },
    data: { arriveDate: day(arrive), departDate: day(depart), chosenOption: chosenOption as Prisma.InputJsonValue },
  });
  await refreshTripQuotes(prisma, id);
  refresh(id);
  redirect(`/trips/${id}?tier=${chosenOption.hotelTier}`);
}

/** "My hotel": price this hotel on every date card. */
export async function pinHotel(f: FormData) {
  const li = await prisma.lineItem.findUniqueOrThrow({ where: { id: str(f, "id") } });
  const name = str(f, "name");
  const spec: HotelSearchSpec = { ...((li.searchSpec ?? {}) as HotelSearchSpec), pinned: name ? { name } : undefined };
  await prisma.lineItem.update({ where: { id: li.id }, data: { searchSpec: spec as Prisma.InputJsonValue } });
  refresh(li.tripId);
}

export async function deleteTrip(f: FormData) {
  await prisma.trip.delete({ where: { id: str(f, "id") } });
  refresh();
  redirect("/");
}

/** Plan / unplan a trip from Home, Compare or the trip page (booked and done trips use Trip details). */
export async function setTripPlanned(f: FormData) {
  const id = str(f, "id");
  const planned = str(f, "planned") === "1";
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id } });
  if (trip.status === "booked" || trip.status === "done") throw new Error("Change booked or finished trips in Trip details");
  await prisma.trip.update({ where: { id }, data: { status: planned ? "planned" : "considering" } });
  // Unplanning the chosen NYE / Asia option reopens that choice.
  if (!planned) {
    for (const key of ["nyeChoice", "asiaDestination"] as const) {
      const row = await prisma.setting.findUnique({ where: { key } });
      const isThis = key === "nyeChoice" ? row?.value === id : trip.slot?.startsWith("Asia");
      if (row && isThis) await prisma.setting.update({ where: { key }, data: { value: "undecided" } });
    }
  }
  refresh(id);
}

/** Pick one option in a compare slot: it becomes planned, the rest go back to considering. */
export async function chooseOption(f: FormData) {
  const id = str(f, "id");
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id } });
  if (trip.slot) {
    await prisma.trip.updateMany({ where: { slot: trip.slot, id: { not: id }, status: "planned" }, data: { status: "considering" } });
  }
  await prisma.trip.update({ where: { id }, data: { status: "planned" } });
  if (trip.slot?.startsWith("NYE")) {
    await prisma.setting.upsert({ where: { key: "nyeChoice" }, create: { key: "nyeChoice", value: id }, update: { value: id } });
  }
  if (trip.slot?.startsWith("Asia")) {
    const value = /tokyo/i.test(trip.name) ? "tokyo" : "china";
    await prisma.setting.upsert({ where: { key: "asiaDestination" }, create: { key: "asiaDestination", value }, update: { value } });
  }
  refresh(id);
}

// ---------- events ----------

/** Spec §14: adding an event automatically creates a trip on the event window. */
export async function createEvent(f: FormData) {
  const start = isoDate(f, "start");
  const end = str(f, "end") ? isoDate(f, "end") : start;
  if (end < start) throw new Error("End before start");
  const airports = str(f, "airports")
    .toUpperCase()
    .split(/[\s,/]+/)
    .filter((a) => /^[A-Z]{3}$/.test(a));
  const country = (str(f, "country") || "US").toUpperCase();
  const event = await prisma.event.create({
    data: {
      name: str(f, "name"),
      city: str(f, "city"),
      country,
      region: country === "US" ? "US" : "Asia",
      venue: str(f, "venue") || null,
      startDate: day(start),
      endDate: day(end),
      airports,
      officialUrl: str(f, "officialUrl") || null,
      genres: [],
      lineupHighlights: [],
      source: "manual",
    },
  });
  const trip = await createTripFromEvent(prisma, event.id, { slot: str(f, "slot") || undefined });
  refresh(trip.id);
  redirect(`/trips/${trip.id}`);
}

export async function addTripForEvent(f: FormData) {
  const eventId = str(f, "eventId");
  const airports = str(f, "airports")
    .toUpperCase()
    .split(/[\s,/]+/)
    .filter((a) => /^[A-Z]{3}$/.test(a));
  if (airports.length) await prisma.event.update({ where: { id: eventId }, data: { airports } });
  const trip = await createTripFromEvent(prisma, eventId);
  refresh(trip.id);
  redirect(`/trips/${trip.id}`);
}

// ---------- settings ----------

async function putSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
  const v = value as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

export async function saveSettings(f: FormData) {
  const current = mergeSettings(await prisma.setting.findMany());
  const n = (k: string, fallback: number) => {
    const v = Number(str(f, k));
    return Number.isFinite(v) && str(f, k) !== "" ? v : fallback;
  };

  await putSetting(
    "originAirports",
    current.originAirports.map((a) => ({
      ...a,
      positioningCost: n(`pos_${a.code}`, a.positioningCost),
      enabled: f.get(`use_${a.code}`) === "on",
    })),
  );
  await putSetting("flexDays", Math.min(3, Math.max(0, n("flexDays", current.flexDays))));
  await putSetting("hotelMinStars", n("hotelMinStars", current.hotelMinStars));
  await putSetting("hotelMinRating10", n("hotelMinRating10", current.hotelMinRating10));
  await putSetting("cppFloor", n("cppFloor", current.cppFloor));
  await putSetting("briefTime", /^\d{2}:\d{2}$/.test(str(f, "briefTime")) ? str(f, "briefTime") : current.briefTime);
  await putSetting("briefChannels", { push: f.get("briefPush") === "on", email: f.get("briefEmail") === "on" });
  await putSetting("serpapiMonthlyQuota", n("serpapiMonthlyQuota", current.serpapiMonthlyQuota));
  await putSetting("freeFlightDailyRequests", Math.max(0, Math.round(n("freeFlightDailyRequests", current.freeFlightDailyRequests))));
  await putSetting("cards", {
    citiStrataVersion: (str(f, "citiStrataVersion") || "unknown") as AppSettings["cards"]["citiStrataVersion"],
    hasChaseSapphire: (str(f, "hasChaseSapphire") || "unknown") as AppSettings["cards"]["hasChaseSapphire"],
    chaseFreedomVersion: (str(f, "chaseFreedomVersion") || "unknown") as AppSettings["cards"]["chaseFreedomVersion"],
  });
  await putSetting("status", { airline: str(f, "statusAirline"), hotel: str(f, "statusHotel") });

  // Card facts that follow from the answers.
  const sapphire = str(f, "hasChaseSapphire");
  if (sapphire !== "unknown") {
    await prisma.card.updateMany({ where: { name: "Chase Freedom" }, data: { transferEnabled: sapphire === "yes", needsSetup: str(f, "chaseFreedomVersion") === "unknown" } });
  }
  const strata = str(f, "citiStrataVersion");
  if (strata && strata !== "unknown") {
    const premium = strata !== "strata";
    await prisma.card.updateMany({
      where: { name: "Citi Strata" },
      data: { version: strata, needsSetup: false, transferEnabled: premium, foreignFeePct: premium ? 0 : 3 },
    });
    await prisma.card.updateMany({ where: { name: "Citi Custom Cash" }, data: { transferEnabled: premium } });
  }
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function resetAirports() {
  await putSetting("originAirports", DEFAULT_SETTINGS.originAirports);
  revalidatePath("/settings");
}

export async function savePoints(f: FormData) {
  for (const currency of ["Amex MR", "Citi TYP", "Chase UR"]) {
    const raw = str(f, `pts_${currency}`).replace(/[,\s]/g, "");
    if (raw === "") continue;
    const balance = Math.max(0, Math.round(Number(raw)));
    if (!Number.isFinite(balance)) continue;
    await prisma.pointsBalance.upsert({ where: { currency }, create: { currency, balance }, update: { balance } });
  }
  await prisma.setting.upsert({
    where: { key: "pointsUpdatedAt" },
    create: { key: "pointsUpdatedAt", value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function dismissAlert(f: FormData) {
  const a = await prisma.alert.update({ where: { id: str(f, "id") }, data: { dismissedAt: new Date() } });
  refresh(a.tripId ?? undefined);
}

// ---------- ticket tracker ----------

async function revalidateEvent(eventId: string) {
  revalidatePath("/tickets");
  revalidatePath("/");
  const trips = await prisma.trip.findMany({ where: { eventId }, select: { id: true } });
  for (const t of trips) revalidatePath(`/trips/${t.id}`);
}

export async function trackTickets(f: FormData) {
  const eventId = str(f, "eventId");
  await ensureTicketWatches(prisma, eventId);
  await revalidateEvent(eventId);
}

export async function setTicketTarget(f: FormData) {
  const eventId = str(f, "eventId");
  await prisma.event.update({
    where: { id: eventId },
    data: { ticketTarget: money(f, "target"), ticketTierHint: str(f, "tierHint") || null },
  });
  await ensureTicketWatches(prisma, eventId);
  await revalidateEvent(eventId);
}

/** Pull the platform's event id out of a pasted link (Ticketmaster /event/{id}, SeatGeek trailing number). */
function externalIdFrom(platform: TicketPlatformId, url: URL): string | null {
  if (platform === "ticketmaster") return url.pathname.match(/\/event\/([A-Za-z0-9]+)/)?.[1] ?? null;
  if (platform === "seatgeek") return url.pathname.match(/\/(\d{5,})(?:\/|$)/)?.[1] ?? null;
  return null;
}

export async function saveTicketLink(f: FormData) {
  const w = await prisma.ticketWatch.findUniqueOrThrow({ where: { id: str(f, "watchId") } });
  const raw = str(f, "url");
  const platform = w.platform as TicketPlatformId;
  if (!raw) {
    await prisma.ticketWatch.update({ where: { id: w.id }, data: { url: null, externalId: null, status: "needs_link", findTried: true } });
  } else {
    const url = new URL(raw);
    const domain = TICKET_PLATFORMS[platform].domain;
    if (domain && !url.hostname.endsWith(domain)) throw new Error(`That link isn't on ${domain}`);
    await prisma.ticketWatch.update({
      where: { id: w.id },
      data: { url: url.toString(), externalId: externalIdFrom(platform, url), status: "ok", lastError: null, findTried: true, lastCheckedAt: null },
    });
  }
  await revalidateEvent(w.eventId);
}

export async function toggleTicketWatch(f: FormData) {
  const w = await prisma.ticketWatch.findUniqueOrThrow({ where: { id: str(f, "watchId") } });
  await prisma.ticketWatch.update({ where: { id: w.id }, data: { enabled: !w.enabled } });
  await revalidateEvent(w.eventId);
}

/** A price seen by hand (any platform; Radiate is always logged this way and never counted). */
export async function logTicketPrice(f: FormData) {
  const eventId = str(f, "eventId");
  const platform = str(f, "platform") as TicketPlatformId;
  if (!TICKET_PLATFORMS[platform]) throw new Error("Unknown platform");
  const price = money(f, "price");
  if (price == null || price <= 0) throw new Error("Enter a price");
  const watch = await prisma.ticketWatch.upsert({
    where: { eventId_platform: { eventId, platform } },
    create: { eventId, platform, status: TICKET_PLATFORMS[platform].access === "manual" ? "manual" : "needs_link" },
    update: {},
  });
  const settings = mergeSettings(await prisma.setting.findMany());
  const url = str(f, "url");
  await recordTicketPrice(
    prisma,
    watch,
    {
      listed: price,
      feesIncluded: f.get("feesIncluded") === "on",
      highestBid: money(f, "highestBid"),
      tierLabel: str(f, "tier") || null,
      source: "manual",
      url: url || null,
      note: str(f, "note") || null,
    },
    settings.ticketFeePct,
  );
  await revalidateEvent(eventId);
}

export async function saveTicketSettings(f: FormData) {
  const fees: Record<string, number> = {};
  for (const id of Object.keys(TICKET_PLATFORMS)) {
    const v = str(f, `fee_${id}`);
    if (v !== "" && Number.isFinite(Number(v))) fees[id] = Math.max(0, Number(v));
  }
  await putSetting("ticketFeePct", fees);
  const gap = Number(str(f, "crowdvoltGapAlert"));
  if (Number.isFinite(gap) && gap >= 0) await putSetting("crowdvoltGapAlert", gap);
  revalidatePath("/settings");
  revalidatePath("/tickets");
}
