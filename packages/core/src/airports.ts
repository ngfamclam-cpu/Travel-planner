// City names for airport codes, so search links read "Boston to Miami" rather than a list of codes.

export const AIRPORT_CITY: Record<string, string> = {
  // Boston-area origins
  BOS: "Boston", PVD: "Providence", MHT: "Manchester NH", JFK: "New York", LGA: "New York", EWR: "Newark",
  // US festival destinations
  MIA: "Miami", FLL: "Fort Lauderdale", MCO: "Orlando", TPA: "Tampa", LAS: "Las Vegas",
  DFW: "Dallas", DAL: "Dallas", PHX: "Phoenix", DEN: "Denver", SAN: "San Diego",
  LAX: "Los Angeles", ONT: "Ontario CA", BUR: "Burbank", SNA: "Santa Ana", SFO: "San Francisco", OAK: "Oakland",
  ORD: "Chicago", MDW: "Chicago", DTW: "Detroit", ATL: "Atlanta", IAD: "Washington DC", DCA: "Washington DC",
  BWI: "Baltimore", PHL: "Philadelphia", SEA: "Seattle", GEG: "Spokane", CMH: "Columbus", MSY: "New Orleans",
  // Asia
  HND: "Tokyo", NRT: "Tokyo", KIX: "Osaka", BKK: "Bangkok", DMK: "Bangkok", ICN: "Seoul", GMP: "Seoul",
  TPE: "Taipei", PVG: "Shanghai", PEK: "Beijing", PKX: "Beijing", CAN: "Guangzhou", SZX: "Shenzhen",
  ZUH: "Zhuhai", HKG: "Hong Kong", SIN: "Singapore",
};

/** "Miami" for [MIA, FLL]; distinct cities joined ("Miami or Fort Lauderdale"); codes if unknown. */
export function cityForAirports(codes: string[]): string {
  const cities = [...new Set(codes.map((c) => AIRPORT_CITY[c.toUpperCase()] ?? c.toUpperCase()))];
  if (cities.length <= 2) return cities.join(" or ");
  return cities[0];
}

/** The city to search flights to: the event's city when it has an airport, else the first airport's city. */
export function flightDestinationCity(eventCity: string | null | undefined, airports: string[]): string {
  const cities = airports.map((a) => AIRPORT_CITY[a.toUpperCase()]).filter(Boolean);
  if (eventCity && cities.some((c) => c.toLowerCase() === eventCity.toLowerCase())) return eventCity;
  return cities[0] ?? cityForAirports(airports);
}
