// Light, once-a-day look at a public event page (Vivid Seats, StubHub, CrowdVolt, DICE, RA).
// Polite by design: honours robots.txt, identifies itself, one request per page, fails soft.
// Reads standard schema.org Event/Offer data first, then embedded app JSON (e.g. Next.js).
import type { TicketPlatformId } from "@rave-run/core";
import type { HttpOpts, TicketCheck, TicketChecker } from "./types";

export const USER_AGENT = "Mozilla/5.0 (compatible; RaveRun/0.1; personal ticket price tracker)";

export interface PagePrice {
  low: number | null;
  highestBid: number | null;
  tierLabel: string | null;
  availability: string | null;
  currency: string | null;
  via: "json-ld" | "app-data" | "meta" | null;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && v.trim() !== "" ? n : null;
  }
  return null;
};

function scripts(html: string, match: RegExp): string[] {
  const out: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) if (match.test(m[1])) out.push(m[2]);
  return out;
}

function parseJson(s: string): unknown {
  try {
    return JSON.parse(s.trim().replace(/^<!--|-->$/g, ""));
  } catch {
    return null;
  }
}

/** Walk any JSON value depth-first. */
function walk(v: unknown, visit: (key: string, value: unknown, parent: Record<string, unknown>) => void, depth = 0) {
  if (depth > 40 || v == null || typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (const x of v) walk(x, visit, depth + 1);
    return;
  }
  const o = v as Record<string, unknown>;
  for (const [k, val] of Object.entries(o)) {
    visit(k, val, o);
    walk(val, visit, depth + 1);
  }
}

function availability(a: unknown): string | null {
  if (typeof a !== "string") return null;
  const s = a.toLowerCase();
  if (s.includes("soldout")) return "soldout";
  if (s.includes("instock") || s.includes("limitedavailability")) return "onsale";
  if (s.includes("preorder") || s.includes("presale")) return "presale";
  if (s.includes("discontinued")) return "offsale";
  return null;
}

/** schema.org Event offers: Offer / AggregateOffer with price or lowPrice. */
function fromJsonLd(html: string): PagePrice | null {
  let low: number | null = null;
  let tier: string | null = null;
  let avail: string | null = null;
  let currency: string | null = null;
  for (const block of scripts(html, /application\/ld\+json/i)) {
    const data = parseJson(block);
    walk(data, (key, value) => {
      if (key !== "offers") return;
      for (const o of Array.isArray(value) ? value : [value]) {
        if (!o || typeof o !== "object") continue;
        const offer = o as Record<string, unknown>;
        const p = num(offer.lowPrice) ?? num(offer.price);
        avail ??= availability(offer.availability);
        if (p != null && p > 0 && (low == null || p < low)) {
          low = p;
          tier = typeof offer.name === "string" ? offer.name : null;
          currency = typeof offer.priceCurrency === "string" ? offer.priceCurrency : currency;
        }
      }
    });
  }
  return low == null && avail == null ? null : { low, highestBid: null, tierLabel: tier, availability: avail, currency, via: "json-ld" };
}

const ASK_KEYS = /^(lowest_?ask|best_?ask|min_?ask|ask_?price|lowest_?price|min_?price|from_?price|price_?from|lowPrice|minPrice|lowestPrice|startingPrice)(_?cents|_?in_?cents)?$/i;
const BID_KEYS = /^(highest_?bid|best_?bid|max_?bid|top_?bid|bid_?price|highestBid|bestBid)(_?cents|_?in_?cents)?$/i;

/** Embedded app JSON (Next.js __NEXT_DATA__, Nuxt, Apollo state): look for ask/bid/lowest price keys. */
function fromAppData(html: string): PagePrice | null {
  const blocks = [
    ...scripts(html, /id=["']__NEXT_DATA__["']/i),
    ...scripts(html, /type=["']application\/json["']/i),
  ];
  let low: number | null = null;
  let bid: number | null = null;
  for (const block of blocks) {
    walk(parseJson(block), (key, value) => {
      const cents = /cents/i.test(key);
      const n = num(value);
      if (n == null || n <= 0) return;
      const v = cents ? n / 100 : n;
      if (ASK_KEYS.test(key) && (low == null || v < low)) low = v;
      if (BID_KEYS.test(key) && (bid == null || v > bid)) bid = v;
    });
  }
  return low == null && bid == null ? null : { low, highestBid: bid, tierLabel: null, availability: null, currency: null, via: "app-data" };
}

function fromMeta(html: string): PagePrice | null {
  const m = html.match(/<meta[^>]+(?:itemprop|property)=["'](?:lowPrice|price|product:price:amount|og:price:amount)["'][^>]*content=["']([^"']+)["']/i);
  const n = m ? num(m[1]) : null;
  return n ? { low: n, highestBid: null, tierLabel: null, availability: null, currency: null, via: "meta" } : null;
}

/** Pure: read the lowest price (and CrowdVolt-style highest bid) from a page. */
export function extractPagePrice(html: string): PagePrice {
  const ld = fromJsonLd(html);
  const app = fromAppData(html);
  const meta = fromMeta(html);
  return {
    low: ld?.low ?? app?.low ?? meta?.low ?? null,
    highestBid: app?.highestBid ?? null,
    tierLabel: ld?.tierLabel ?? null,
    availability: ld?.availability ?? null,
    currency: ld?.currency ?? null,
    via: ld?.low != null ? "json-ld" : app?.low != null ? "app-data" : meta?.low != null ? "meta" : ld ? "json-ld" : null,
  };
}

const BLOCK_SIGNS = /captcha|access denied|attention required|cf-chl|are you a robot|px-captcha|request unsuccessful|bot detection/i;

/** Minimal robots.txt check for User-agent: * (longest matching rule wins). */
export function robotsAllows(robots: string, path: string): boolean {
  let applies = false;
  const rules: { allow: boolean; prefix: string }[] = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, field, value] = m;
    const f = field.toLowerCase();
    if (f === "user-agent") applies = value.trim() === "*";
    else if (applies && (f === "allow" || f === "disallow") && value) rules.push({ allow: f === "allow", prefix: value.trim() });
  }
  const hits = rules.filter((r) => path.startsWith(r.prefix.replace(/\*$/, "")));
  if (!hits.length) return true;
  return hits.sort((a, b) => b.prefix.length - a.prefix.length)[0].allow;
}

export class PageChecker implements TicketChecker {
  configured = true;
  envKeys: string[] = [];
  private robotsCache = new Map<string, string | null>();
  constructor(
    public platform: TicketPlatformId,
    private opts: HttpOpts & { listedIncludesFees: boolean; respectRobots?: boolean },
  ) {}

  private async robots(origin: string): Promise<string | null> {
    if (this.robotsCache.has(origin)) return this.robotsCache.get(origin)!;
    let text: string | null = null;
    try {
      const res = await (this.opts.fetchImpl ?? fetch)(`${origin}/robots.txt`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
      text = res.ok ? await res.text() : null;
    } catch {
      text = null;
    }
    this.robotsCache.set(origin, text);
    return text;
  }

  async check(w: { url?: string | null }): Promise<TicketCheck> {
    const platform = this.platform;
    if (!w.url) return { ok: false, platform, error: "no event page linked yet", noPrice: true };
    let u: URL;
    try {
      u = new URL(w.url);
    } catch {
      return { ok: false, platform, error: "bad event URL" };
    }
    if (this.opts.respectRobots !== false) {
      const robots = await this.robots(u.origin);
      if (robots && !robotsAllows(robots, u.pathname)) {
        return { ok: false, platform, error: "robots.txt asks automated tools not to read this page; check it manually", blocked: true };
      }
    }
    let html: string;
    try {
      const res = await (this.opts.fetchImpl ?? fetch)(u.toString(), {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en" },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
      });
      html = await res.text();
      if (res.status === 403 || res.status === 429 || res.status === 503 || (res.ok && BLOCK_SIGNS.test(html.slice(0, 20_000)) && !/application\/ld\+json/i.test(html))) {
        return { ok: false, platform, error: `site blocked the automated check (HTTP ${res.status}); check it manually`, blocked: true };
      }
      if (!res.ok) return { ok: false, platform, error: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, platform, error: (e as Error).message };
    }
    const p = extractPagePrice(html);
    if (p.low == null) {
      return { ok: false, platform, error: p.availability === "soldout" ? "sold out" : "couldn't find a price on the page (layout may have changed)", noPrice: true, status: p.availability };
    }
    return {
      ok: true,
      platform,
      listed: p.low,
      feesIncluded: this.opts.listedIncludesFees,
      highestBid: p.highestBid,
      tierLabel: p.tierLabel,
      status: p.availability,
      url: u.toString(),
      raw: { via: p.via, currency: p.currency },
    };
  }
}
