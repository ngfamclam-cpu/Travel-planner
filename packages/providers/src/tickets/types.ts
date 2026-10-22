import type { TicketPlatformId } from "@rave-run/core";

export interface TicketEventRef {
  name: string;
  city: string;
  start: string; // ISO date
  end: string;
}

/** Where an event lives on a platform. */
export interface TicketMatch {
  url: string;
  externalId?: string;
  title?: string;
}

export type TicketCheck =
  | {
      ok: true;
      platform: TicketPlatformId;
      /** Lowest price as the site shows it. */
      listed: number;
      /** True when the site's price already includes buyer fees. */
      feesIncluded: boolean;
      highestBid?: number | null;
      tierLabel?: string | null;
      /** Official status: onsale | offsale | soldout | presale | cancelled. */
      status?: string | null;
      url: string;
      raw?: unknown;
    }
  | {
      ok: false;
      platform: TicketPlatformId;
      error: string;
      /** The site refused an automated check (403, captcha, robots.txt). */
      blocked?: boolean;
      /** The page/API had no price (sold out, not on sale yet, or not listed). */
      noPrice?: boolean;
      status?: string | null;
      notConfigured?: boolean;
    };

export interface TicketChecker {
  platform: TicketPlatformId;
  configured: boolean;
  envKeys: string[];
  /** Find the event on this platform (API search). Page platforms use the SerpApi finder instead. */
  find?(e: TicketEventRef): Promise<TicketMatch | null>;
  check(watch: { url?: string | null; externalId?: string | null }): Promise<TicketCheck>;
}

export interface HttpOpts {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}
