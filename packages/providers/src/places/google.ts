// Google Places API (New): ratings and better coverage. Needs GOOGLE_PLACES_API_KEY (billing enabled).
import type { Place } from "@rave-run/core";
import type { HttpOpts } from "../tickets/types";

interface GPlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  primaryType?: string;
  googleMapsUri?: string;
  location?: { latitude?: number; longitude?: number };
}

const FIELDS = "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.primaryType,places.googleMapsUri,places.location";

export function parseGooglePlaces(json: { places?: GPlace[] }, kind: Place["kind"]): Place[] {
  return (json.places ?? [])
    .filter((p) => p.displayName?.text)
    .map((p) => ({
      id: `g:${p.id}`,
      name: p.displayName!.text!,
      kind,
      cuisine: p.primaryType?.replace(/_restaurant$/, "").replace(/_/g, " ") ?? null,
      address: p.formattedAddress ?? null,
      rating: p.rating ?? null,
      ratingCount: p.userRatingCount ?? null,
      url: p.googleMapsUri ?? null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
    }));
}

export async function googlePlaces(apiKey: string, lat: number, lng: number, opts: HttpOpts = {}): Promise<Place[]> {
  const search = async (types: string[], radius: number, kind: Place["kind"]) => {
    const res = await (opts.fetchImpl ?? fetch)("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey, "x-goog-fieldmask": FIELDS },
      body: JSON.stringify({
        includedTypes: types,
        maxResultCount: 20,
        rankPreference: "POPULARITY",
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
    if (!res.ok) throw new Error(`Google Places HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return parseGooglePlaces((await res.json()) as { places?: GPlace[] }, kind);
  };
  const [food, sights] = await Promise.all([
    search(["restaurant"], 1500, "food"),
    search(["tourist_attraction", "museum", "park"], 4000, "sight"),
  ]);
  return [...food, ...sights];
}
