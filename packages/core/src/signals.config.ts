// Buy-signal thresholds (spec §7). Tune here; everything else reads from this file.
export const SIGNAL_RULES = {
  flight: {
    /** Days before departure when fares are usually best. */
    domesticSweetSpot: [21, 90] as [number, number],
    internationalSweetSpot: [60, 150] as [number, number],
    /** Inside this many days, fares only rise: buy. */
    domesticLastCall: 21,
    internationalLastCall: 45,
    /** Inside the sweet spot, buy when within this share of the 30-day low. */
    nearLowPct: 0.05,
    /** Peak weeks (NYE, spring break, cherry blossom): start the sweet spot this many days earlier and accept a wider margin. */
    peakEarlierDays: 30,
    peakNearLowPct: 0.1,
    historyDays: 30,
    /** Fewer days of prices than this and "lowest so far" isn't meaningful yet. */
    minHistoryPoints: 7,
  },
  ticket: {
    /** Tier names that mean "no cheaper tier left". */
    lastTierPattern: /\b(last|final)\b/i,
  },
};
