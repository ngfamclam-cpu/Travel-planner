import type { HotelOffer, HotelQuery } from "@rave-run/core";
import type { HotelProvider, ProviderResult } from "../types";

export class UnconfiguredHotelProvider implements HotelProvider {
  readonly info = { name: "none", tier: "free" as const, configured: false, envKeys: ["SERPAPI_KEY"] };
  async search(_q: HotelQuery): Promise<ProviderResult<HotelOffer>> {
    return { ok: false, provider: this.info.name, error: "No hotel provider configured (set SERPAPI_KEY)", notConfigured: true };
  }
}
