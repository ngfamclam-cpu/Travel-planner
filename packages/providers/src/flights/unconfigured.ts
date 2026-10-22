import type { FlightOffer, FlightQuery } from "@rave-run/core";
import type { FlightProvider, ProviderResult } from "../types";

/** Used when no flight data key is set: never fabricates prices, just reports why. */
export class UnconfiguredFlightProvider implements FlightProvider {
  readonly info = { name: "none", tier: "free" as const, configured: false, envKeys: ["SERPAPI_KEY"] };
  async search(_q: FlightQuery): Promise<ProviderResult<FlightOffer>> {
    return { ok: false, provider: this.info.name, error: "No flight provider configured (set SERPAPI_KEY)", notConfigured: true };
  }
}
