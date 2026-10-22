// One-time lookup of an event's page on a platform, via SerpApi Google search (1 search per find).
import type { TicketEventRef, TicketMatch, HttpOpts } from "./types";
import { serpApiGet } from "../serpapi-http";

interface SerpGoogle {
  error?: string;
  organic_results?: { link?: string; title?: string }[];
}

/** Links that look like an event page rather than search, category or help pages. */
export function looksLikeEventPage(link: string, domain: string): boolean {
  try {
    const u = new URL(link);
    if (!u.hostname.endsWith(domain)) return false;
    const p = u.pathname.toLowerCase();
    if (p === "/" || /\/(search|help|blog|about|careers|legal|faq)(\/|$)/.test(p)) return false;
    return p.split("/").filter(Boolean).length >= 1;
  } catch {
    return false;
  }
}

export async function findEventPage(
  e: TicketEventRef,
  domain: string,
  apiKey: string | undefined,
  http: HttpOpts = {},
): Promise<TicketMatch | null> {
  if (!apiKey) return null;
  const year = e.start.slice(0, 4);
  const params = new URLSearchParams({ engine: "google", q: `site:${domain} "${e.name}" ${e.city} ${year}`, num: "10", hl: "en", gl: "us", api_key: apiKey });
  const json = await serpApiGet<SerpGoogle>(params, http);
  const hit = (json.organic_results ?? []).find((r) => r.link && looksLikeEventPage(r.link, domain));
  return hit?.link ? { url: hit.link, title: hit.title } : null;
}
