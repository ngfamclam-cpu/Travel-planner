// Daily brief (spec §9). The payload holds every fact; the summary prose may only repeat its numbers.

export interface BriefItem {
  kind: string;
  label: string;
  /** Total for this item in dollars (rounded), or null if not priced. */
  amount: number | null;
  state: "booked" | "quoted" | "estimate" | "unpriced";
  signal: string | null;
  reason: string | null;
  card: string | null;
  /** Quote older than 48h: reported as last-checked, never as a current price. */
  lastChecked: string | null;
}

export interface BriefTrip {
  name: string;
  status: string;
  dates: string;
  daysAway: number;
  total: number;
  /** Dollar change since the previous brief (null if no earlier brief). */
  change: number | null;
  notPriced: number;
  buyNow: number;
  items: BriefItem[];
  url: string;
}

export interface BriefPayload {
  date: string;
  dateLabel: string;
  counts: { actions: number; plannedTrips: number; buyNow: number; newEvents: number; problems: number };
  actions: { kind: string; title: string; detail: string; url: string | null }[];
  trips: BriefTrip[];
  /** cheapest = cheapest fully priced option (null when none is fully priced yet). */
  considering: { group: string; options: number; cheapest: { name: string; total: number } | null }[];
  newEvents: { name: string; city: string; dates: string; artists: string[]; clashesWith: string[]; url: string | null }[];
  problems: { source: string; note: string }[];
  savings: { month: string; paidWouldHaveSaved: number; paidTierCost: number } | null;
}

const NUM = /\$?-?\d[\d,]*(?:\.\d+)?/g;

function toNumber(raw: string): number | null {
  const n = Number(raw.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Every number that appears in the payload (values and numbers inside strings like "Mar 25"). */
export function payloadNumbers(payload: unknown): Set<string> {
  const out = new Set<string>();
  const add = (n: number) => {
    out.add(String(n));
    out.add(String(Math.abs(n)));
    out.add(String(Math.round(Math.abs(n))));
  };
  const walk = (v: unknown) => {
    if (typeof v === "number") add(v);
    else if (typeof v === "string") for (const m of v.match(NUM) ?? []) { const n = toNumber(m); if (n != null) add(n); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(payload);
  return out;
}

/** Numbers in the prose that don't appear in the payload (empty = safe to send). */
export function inventedNumbers(prose: string, payload: unknown): string[] {
  const allowed = payloadNumbers(payload);
  const bad: string[] = [];
  for (const m of prose.match(NUM) ?? []) {
    const n = toNumber(m);
    if (n == null) continue;
    if (!allowed.has(String(Math.abs(n))) && !allowed.has(String(Math.round(Math.abs(n))))) bad.push(m);
  }
  return bad;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${usd(Math.abs(n))}`;

/** Plain summary used when Claude isn't configured or its prose fails the number check. */
export function templateSummary(p: BriefPayload): string {
  const parts: string[] = [];
  if (p.counts.actions) parts.push(`${p.counts.actions} thing${p.counts.actions === 1 ? "" : "s"} to act on today, starting with: ${p.actions[0].title}.`);
  else parts.push("Nothing needs action today.");
  for (const t of p.trips.slice(0, 3)) {
    parts.push(`${t.name} is ${usd(t.total)}${t.change ? ` (${signed(t.change)} since yesterday)` : ""}${t.buyNow ? `, ${t.buyNow} to buy now` : ""}.`);
  }
  if (p.counts.newEvents) parts.push(`${p.counts.newEvents} new event${p.counts.newEvents === 1 ? "" : "s"} found this week.`);
  if (p.counts.problems) parts.push(`Some prices couldn't be checked: see the end of the brief.`);
  return parts.join(" ");
}

export function pushText(p: BriefPayload): { title: string; body: string } {
  const bits = [p.counts.actions ? `${p.counts.actions} to act on` : "Nothing urgent"];
  const t = p.trips[0];
  if (t) bits.push(`${t.name} ${usd(t.total)}${t.change ? ` (${signed(t.change)})` : ""}`);
  if (p.counts.newEvents) bits.push(`${p.counts.newEvents} new events`);
  return { title: `Rave Run · ${p.dateLabel}`, body: bits.join(" · ") };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderBriefText(p: BriefPayload, summary: string, baseUrl = ""): string {
  const L: string[] = [`Rave Run brief: ${p.dateLabel}`, "", summary, ""];
  if (p.actions.length) {
    L.push("ACTION ITEMS");
    for (const a of p.actions) L.push(`- ${a.title}: ${a.detail}${a.url ? ` (${a.url})` : ""}`);
    L.push("");
  }
  for (const t of p.trips) {
    L.push(`${t.name.toUpperCase()}: ${usd(t.total)}${t.change != null ? ` (${signed(t.change)} vs yesterday)` : ""} · ${t.dates}, ${t.daysAway} days away`);
    for (const i of t.items) {
      const price = i.amount == null ? "not priced" : `${usd(i.amount)} ${i.state}`;
      L.push(`  - ${i.label}: ${price}${i.lastChecked ? ` (last checked ${i.lastChecked})` : ""}${i.signal ? ` · ${i.signal.replace("_", " ")}` : ""}${i.reason ? `: ${i.reason}` : ""}${i.card ? ` · card: ${i.card}` : ""}`);
    }
    L.push(`  ${baseUrl}${t.url}`, "");
  }
  for (const c of p.considering) L.push(`${c.group}: ${c.options} options${c.cheapest ? `, cheapest fully priced: ${c.cheapest.name} at ${usd(c.cheapest.total)}` : ", none fully priced yet"}`);
  if (p.considering.length) L.push("");
  if (p.newEvents.length) {
    L.push("NEW EVENTS");
    for (const e of p.newEvents) L.push(`- ${e.name}, ${e.city}, ${e.dates}${e.artists.length ? ` · ${e.artists.join(", ")}` : ""}${e.clashesWith.length ? ` · clashes with ${e.clashesWith.join(", ")}` : ""}`);
    L.push("");
  }
  if (p.savings) L.push(`Paid data would have saved ${usd(p.savings.paidWouldHaveSaved)} this month (costs ${usd(p.savings.paidTierCost)}).`, "");
  if (p.problems.length) {
    L.push("COULDN'T CHECK");
    for (const x of p.problems) L.push(`- ${x.source}: ${x.note}`);
  }
  return L.join("\n").trim() + "\n";
}

export function renderBriefHtml(p: BriefPayload, summary: string, baseUrl = ""): string {
  const chip = (s: string | null) => {
    if (!s) return "";
    const color = s === "BUY_NOW" ? "#15803d" : s === "WAIT" ? "#a16207" : s === "WATCH" ? "#1d4ed8" : "#6b7280";
    return ` <b style="color:${color}">${esc(s.replace("_", " "))}</b>`;
  };
  const h: string[] = [
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:640px;margin:0 auto;color:#17151f">`,
    `<h2 style="margin:0 0 4px">Rave Run · ${esc(p.dateLabel)}</h2>`,
    `<p style="font-size:15px;line-height:1.5">${esc(summary)}</p>`,
  ];
  if (p.actions.length) {
    h.push(`<h3>Action items</h3><ul>`);
    for (const a of p.actions) h.push(`<li><b>${esc(a.title)}</b>: ${esc(a.detail)}${a.url ? ` <a href="${esc(a.url)}">open</a>` : ""}</li>`);
    h.push(`</ul>`);
  }
  for (const t of p.trips) {
    h.push(`<h3 style="margin-bottom:2px"><a href="${esc(baseUrl + t.url)}" style="color:#7e22ce">${esc(t.name)}</a>: ${usd(t.total)}${t.change != null ? ` <span style="color:#6b7280">(${signed(t.change)} vs yesterday)</span>` : ""}</h3>`);
    h.push(`<div style="color:#6b7280;font-size:13px">${esc(t.dates)} · ${t.daysAway} days away${t.notPriced ? ` · ${t.notPriced} not priced` : ""}</div><ul style="padding-left:18px">`);
    for (const i of t.items) {
      h.push(
        `<li>${esc(i.label)}: ${i.amount == null ? "not priced" : `${usd(i.amount)} <span style="color:#6b7280">${i.state}</span>`}${i.lastChecked ? ` <span style="color:#b91c1c">(last checked ${esc(i.lastChecked)})</span>` : ""}${chip(i.signal)}${i.reason ? `: ${esc(i.reason)}` : ""}${i.card ? `<br><span style="color:#6b7280;font-size:13px">💳 ${esc(i.card)}</span>` : ""}</li>`,
      );
    }
    h.push(`</ul>`);
  }
  if (p.considering.length) {
    h.push(`<h3>Still deciding</h3><ul>`);
    for (const c of p.considering) h.push(`<li>${esc(c.group)}: ${c.options} options${c.cheapest ? `, cheapest fully priced: ${esc(c.cheapest.name)} at ${usd(c.cheapest.total)}` : ", none fully priced yet"}</li>`);
    h.push(`</ul>`);
  }
  if (p.newEvents.length) {
    h.push(`<h3>New events</h3><ul>`);
    for (const e of p.newEvents)
      h.push(`<li>${e.url ? `<a href="${esc(e.url)}">${esc(e.name)}</a>` : esc(e.name)}, ${esc(e.city)}, ${esc(e.dates)}${e.artists.length ? ` · ★ ${esc(e.artists.join(", "))}` : ""}${e.clashesWith.length ? ` · <span style="color:#b91c1c">clashes with ${esc(e.clashesWith.join(", "))}</span>` : ""}</li>`);
    h.push(`</ul>`);
  }
  if (p.savings) h.push(`<p>Paid data would have saved <b>${usd(p.savings.paidWouldHaveSaved)}</b> this month (costs ${usd(p.savings.paidTierCost)}).</p>`);
  if (p.problems.length) {
    h.push(`<h3>Couldn't check</h3><ul style="color:#6b7280">`);
    for (const x of p.problems) h.push(`<li>${esc(x.source)}: ${esc(x.note)}</li>`);
    h.push(`</ul>`);
  }
  h.push(`<p style="color:#6b7280;font-size:12px">Every price above comes from the app's database. Nothing is bought for you.</p></div>`);
  return h.join("\n");
}
