// Arrival guides (spec §10): real places from a places source; Claude only picks among them and writes around them.

export interface Place {
  id: string;
  name: string;
  kind: "food" | "drink" | "sight" | "park" | "nightlife";
  cuisine?: string | null;
  address?: string | null;
  rating?: number | null;
  ratingCount?: number | null;
  /** Open past 1 AM (from opening hours, when the source has them). */
  lateNight?: boolean;
  url?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface GuidePick {
  placeId: string;
  name: string;
  why: string;
  lateNight?: boolean;
  url?: string | null;
}

export interface ArrivalGuideContent {
  where: { label: string; lat: number; lng: number };
  neighborhoods: { name: string; why: string }[];
  food: GuidePick[];
  todo: GuidePick[];
  gettingThere: string[];
  survival: string[];
  writtenBy: "claude" | "template";
  placesSource: string;
  note?: string;
}

export interface GuideContext {
  tripName: string;
  venue: string | null;
  city: string;
  country: string;
  /** Event days (YYYY-MM-DD) and the trip window. */
  eventStart: string | null;
  eventEnd: string | null;
  arrive: string;
  depart: string;
  indoor: boolean;
  /** Line items that matter for getting around (e.g. "EDC shuttle pass"). */
  groundItems: string[];
  hotelArea: string | null;
}

const COUNTRY_TIPS: Record<string, string[]> = {
  JP: [
    "Get a Suica or PASMO card in your phone's wallet for trains and convenience stores.",
    "Trains stop around midnight: plan the last train or budget for a taxi after late sets.",
    "Carry some cash; smaller places may not take cards. Discover works on the JCB network.",
  ],
  TH: ["Songkran week: everything gets soaked; use a waterproof phone pouch.", "Grab is the easiest way to get around; agree on taxi meters before riding."],
  KR: ["Get a T-money card for subway and buses.", "Kakao T works better than Uber for taxis."],
  CN: ["Set up Alipay or WeChat Pay with a foreign card before you go; many places don't take cards.", "Google services are blocked: download offline maps and a VPN first."],
  TW: ["Get an EasyCard for the MRT and convenience stores."],
};

/** Practical festival notes for this trip (spec §10: water, earplugs, rideshare surge, bag policy…). */
export function survivalNotes(ctx: GuideContext): string[] {
  const month = Number((ctx.eventStart ?? ctx.arrive).slice(5, 7));
  const notes = [
    "Bring an empty refillable bottle or hydration pack: check the festival's rules on size and type first.",
    "Wear earplugs (the reusable musician kind); your ears will thank you on day 2.",
    "Check the official bag policy (clear bags, hydration-pack rules) before you pack.",
    "Rideshare surges right after the last set: walk a few blocks away, leave a song early, or use the official shuttle/transit.",
    "Pick a meeting spot in case phones die, and bring a charged battery pack.",
  ];
  if (!ctx.indoor && month >= 5 && month <= 9) notes.push("Sun and heat: sunscreen, a hat, and electrolytes during the day.");
  if (!ctx.indoor && (month <= 2 || month === 12)) notes.push("Cold nights: layers you can tie around your waist, and check whether there's a coat check.");
  if (ctx.indoor) notes.push("Indoor venue: plan for coat check lines at the end of the night.");
  if (ctx.country === "US" && month === 3 && /miami/i.test(ctx.city)) notes.push("Miami in March: afternoon sun is strong and storms can roll in; pack a light poncho.");
  return [...notes, ...(COUNTRY_TIPS[ctx.country] ?? [])];
}

export function gettingThereNotes(ctx: GuideContext): string[] {
  const out: string[] = [];
  const venue = ctx.venue && ctx.venue !== "TBA" ? ctx.venue : null;
  if (ctx.groundItems.some((g) => /shuttle/i.test(g))) out.push("You have a shuttle pass on this trip: check pickup points and last-departure times in the festival app.");
  if (venue) out.push(`Search "${venue}" in Maps from your hotel to compare transit vs. rideshare times before day 1.`);
  out.push("Save the venue's rideshare pickup zone in your maps app; it's usually a short walk from the exit.");
  return out;
}

/** Guide without Claude: highest-rated places first, late-night food flagged. */
export function templateGuide(ctx: GuideContext, where: ArrivalGuideContent["where"], places: Place[], placesSource: string, note?: string): ArrivalGuideContent {
  const score = (p: Place) => (p.rating ?? 0) * Math.log10(10 + (p.ratingCount ?? 0)) + (p.cuisine ? 0.2 : 0);
  const eat = places.filter((p) => p.kind === "food").sort((a, b) => score(b) - score(a));
  const late = eat.filter((p) => p.lateNight).slice(0, 2);
  const food = [...late, ...eat.filter((p) => !late.includes(p))].slice(0, 7);
  const todo = places.filter((p) => p.kind === "sight" || p.kind === "park").sort((a, b) => score(b) - score(a)).slice(0, 5);
  const pick = (p: Place): GuidePick => ({
    placeId: p.id,
    name: p.name,
    why: [p.cuisine?.replace(/[_;]/g, " "), p.lateNight ? "open late" : null, p.rating ? `${p.rating}★` : null].filter(Boolean).join(" · ") || p.kind,
    lateNight: p.lateNight,
    url: p.url,
  });
  return {
    where,
    neighborhoods: [],
    food: food.map(pick),
    todo: todo.map(pick),
    gettingThere: gettingThereNotes(ctx),
    survival: survivalNotes(ctx),
    writtenBy: "template",
    placesSource,
    note,
  };
}

/** Keep only picks that name a real place from the list (by id), with the place's own name and link. */
export function verifyPicks(picks: { placeId: string; why: string }[], places: Place[]): GuidePick[] {
  const byId = new Map(places.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: GuidePick[] = [];
  for (const k of picks) {
    const p = byId.get(k.placeId);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ placeId: p.id, name: p.name, why: k.why.slice(0, 200), lateNight: p.lateNight, url: p.url });
  }
  return out;
}

/** Is a 24h opening-hours string open past 1 AM? Handles OSM ("Mo-Su 11:00-03:00", "24/7"). */
export function opensLate(hours: string | null | undefined): boolean {
  if (!hours) return false;
  if (/24\/7/.test(hours)) return true;
  for (const m of hours.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)) {
    const start = Number(m[1]);
    const end = Number(m[3]);
    if ((end < start && end >= 1) || (end >= 25)) return true;
  }
  return false;
}
