import { describe, expect, it } from "vitest";
import { centsPerPoint, earnFor, pickCards, redeemVerdict, type CardLike } from "./index";

const cards: CardLike[] = [
  { id: "gold", name: "Amex Gold", foreignFeePct: 0, pointsCurrency: "Amex MR", earnRules: { restaurants: 4, us_supermarkets: 4, flights_direct: 3, default: 1 } },
  { id: "cc", name: "Citi Custom Cash", foreignFeePct: 3, pointsCurrency: "Citi TYP", earnRules: { top_category: 5, top_category_cap_per_cycle: 500, top_category_use: "live_entertainment", eligible: ["live_entertainment", "travel", "restaurants"], default: 1 } },
  { id: "prime", name: "Chase Amazon (Prime Visa)", foreignFeePct: 0, pointsCurrency: "cash back", earnRules: { amazon_wholefoods: 5, restaurants: 2, gas: 2, default: 1 } },
  { id: "disc", name: "Discover", foreignFeePct: 0, pointsCurrency: "cash back", earnRules: { rotating_quarterly: 5, default: 1 } },
];
const valueOf = (c: string | null) => (c === "Amex MR" ? 1.5 : 1);

describe("cpp", () => {
  it("computes cents per point and the verdict", () => {
    expect(centsPerPoint(1429, 85.6, 60000)).toBe(2.24);
    expect(redeemVerdict(2.24, 1.5).verdict).toBe("redeem");
    expect(redeemVerdict(1.1, 1.5).verdict).toBe("pay_cash");
  });
});

describe("card picker (spec seed recommendations)", () => {
  it("tickets → Custom Cash, with a split note over $500", () => {
    const p = pickCards(cards, "ticket", { abroad: false, amount: 1034, valueOf });
    expect(p[0]).toMatchObject({ name: "Citi Custom Cash", multiplier: 5 });
    expect(p[0].notes.join()).toContain("split the purchase across cycles");
  });
  it("flights → Amex Gold (3x direct at 1.5¢ = 4.5%)", () => {
    expect(pickCards(cards, "flight", { abroad: false, amount: 427, valueOf })[0]).toMatchObject({ name: "Amex Gold", returnPct: 4.5 });
  });
  it("restaurants → Amex Gold", () => {
    expect(pickCards(cards, "food", { abroad: false, amount: 60, valueOf })[0].name).toBe("Amex Gold");
  });
  it("abroad never picks a foreign-fee card when a no-fee card earns about the same", () => {
    // In Japan: Custom Cash 1x − 3% fee = −2%; Amex Gold 1x hotel at 1.5¢ = 1.5% → Amex

    const p = pickCards(cards, "hotel", { abroad: true, amount: 1800, valueOf });
    expect(p[0].name).toBe("Amex Gold");
    expect(p.find((x) => x.name === "Citi Custom Cash")!.notes).toContain("3% foreign transaction fee");
  });
  it("prefers a no-fee card abroad when it's within a point of a fee card", () => {
    const feeCard: CardLike = { id: "f", name: "Fee Card", foreignFeePct: 3, pointsCurrency: "cash back", earnRules: { restaurants: 5 } };
    // abroad: Fee Card 5% − 3% = 2%; Amex Gold 4x at 1.5¢ = 6% → Amex anyway. Make Amex close: value 0.6¢ → 2.4%
    const p = pickCards([feeCard, cards[0]], "food", { abroad: true, amount: 40, valueOf: (c) => (c === "Amex MR" ? 0.45 : 1) });
    // Amex 4 × 0.45 = 1.8% vs Fee Card 2% → Fee Card is best on paper, but Amex is within 1 point and has no fee
    expect(p[0]).toMatchObject({ name: "Amex Gold", notes: ["no foreign fee, earns about the same"] });
  });
  it("notes when the top category is aimed elsewhere", () => {
    expect(earnFor(cards[1], "flight", 400)).toMatchObject({ multiplier: 1, notes: ["5x is aimed at live entertainment this cycle"] });
  });
  it("mentions rotating categories", () => {
    expect(earnFor(cards[3], "food", 50).notes[0]).toContain("rotating");
  });
});
