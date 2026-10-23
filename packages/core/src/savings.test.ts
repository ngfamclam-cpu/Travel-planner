import { describe, expect, it } from "vitest";
import { savingsThisMonth } from "./index";

describe("savings meter", () => {
  it("uses the latest comparison per item, counts only cheaper paid finds, suggests upgrading past the cost", () => {
    const rows = [
      { lineItemId: "ultra", date: "2026-11-02", freeBest: 450, paidBest: 400 }, // superseded
      { lineItemId: "ultra", date: "2026-11-20", freeBest: 427, paidBest: 410 },
      { lineItemId: "edc", date: "2026-11-21", freeBest: 399, paidBest: 405 }, // free was cheaper
      { lineItemId: "tokyo", date: "2026-11-22", freeBest: 1450, paidBest: 1429 },
      { lineItemId: "old", date: "2026-10-30", freeBest: 900, paidBest: 500 }, // last month
    ];
    expect(savingsThisMonth(rows, "2026-11")).toEqual({ month: "2026-11", wouldHaveSaved: 38, comparisons: 3, itemsCheaper: 2, paidTierCost: 25, suggestUpgrade: true });
    expect(savingsThisMonth(rows.slice(0, 3), "2026-11").suggestUpgrade).toBe(false); // $17 < $25
  });
});
