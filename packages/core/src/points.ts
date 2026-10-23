// Points & card engine (spec §8): cents-per-point maths and the card picker.

/** cpp = (cash price − award taxes/fees) ÷ points × 100 */
export function centsPerPoint(cashPrice: number, taxesFees: number, points: number): number {
  if (points <= 0) return 0;
  return Math.round(((cashPrice - taxesFees) / points) * 100 * 100) / 100;
}

export function redeemVerdict(cpp: number, floor: number): { verdict: "redeem" | "pay_cash"; text: string } {
  return cpp >= floor
    ? { verdict: "redeem", text: `${cpp.toFixed(2)}¢/pt beats your ${floor}¢ floor: use points` }
    : { verdict: "pay_cash", text: `${cpp.toFixed(2)}¢/pt is under your ${floor}¢ floor: pay cash and earn` };
}

export type SpendCategory = "flight" | "hotel" | "ticket" | "food" | "ground" | "other";

/** Which earn-rule keys apply to a spend category, best match first. */
const RULE_KEYS: Record<SpendCategory, string[]> = {
  flight: ["flights_direct", "air", "travel"],
  hotel: ["hotels", "travel"],
  ticket: ["live_entertainment", "entertainment"],
  food: ["restaurants", "dining"],
  ground: ["transit", "travel"],
  other: [],
};

/** Custom Cash-style "top category" names that cover each spend category. */
const TOP_CATEGORY_NAMES: Record<SpendCategory, string[]> = {
  flight: ["travel"],
  hotel: ["travel"],
  ticket: ["live_entertainment"],
  food: ["restaurants"],
  ground: ["travel", "transit"],
  other: [],
};

export interface CardLike {
  id: string;
  name: string;
  foreignFeePct: number | null;
  pointsCurrency: string | null;
  earnRules: Record<string, unknown>;
  needsSetup?: boolean;
}

export interface CardPick {
  cardId: string;
  name: string;
  multiplier: number;
  /** Estimated % back after the foreign fee (points valued at your valuation). */
  returnPct: number;
  reason: string;
  notes: string[];
}

/** Earn multiplier for a category, plus any caveats (caps, rotating categories). */
export function earnFor(card: CardLike, category: SpendCategory, amount: number): { multiplier: number; label: string; notes: string[] } {
  const rules = card.earnRules;
  const num = (k: string) => (typeof rules[k] === "number" ? (rules[k] as number) : null);
  const notes: string[] = [];
  for (const key of RULE_KEYS[category]) {
    const m = num(key);
    if (m != null) return { multiplier: m, label: key.replace(/_/g, " "), notes };
  }
  const top = num("top_category");
  const eligible = Array.isArray(rules.eligible) ? (rules.eligible as string[]) : [];
  // The 5x applies to one category per billing cycle; `top_category_use` says which one you aim it at.
  const aimedAt = typeof rules.top_category_use === "string" ? rules.top_category_use : null;
  const covers = TOP_CATEGORY_NAMES[category].some((c) => eligible.includes(c) && (!aimedAt || c === aimedAt));
  if (top != null && !covers && aimedAt && TOP_CATEGORY_NAMES[category].some((c) => eligible.includes(c))) {
    notes.push(`${top}x is aimed at ${aimedAt.replace(/_/g, " ")} this cycle`);
  }
  if (top != null && covers) {
    const cap = num("top_category_cap_per_cycle");
    if (cap && amount > cap) notes.push(`${top}x only on the first $${cap} per billing cycle: split the purchase across cycles`);
    return { multiplier: top, label: "top category (only if it's your biggest category this cycle)", notes };
  }
  if (num("rotating_quarterly") != null) notes.push(`${num("rotating_quarterly")}x if this quarter's rotating category covers it`);
  return { multiplier: num("default") ?? 1, label: "everything else", notes };
}

/**
 * Best card for a purchase. Abroad, cards with a foreign fee lose that fee from their return, and a
 * no-fee card wins whenever it's within 1 point of the best (spec §14).
 */
export function pickCards(
  cards: CardLike[],
  category: SpendCategory,
  opts: { abroad: boolean; amount: number; valueOf: (currency: string | null) => number },
): CardPick[] {
  const picks = cards.map((c) => {
    const e = earnFor(c, category, opts.amount);
    const value = opts.valueOf(c.pointsCurrency);
    const fee = opts.abroad ? (c.foreignFeePct ?? 3) : 0; // unknown fee counted as the usual 3%
    const returnPct = Math.round((e.multiplier * value - fee) * 100) / 100;
    const notes = [...e.notes];
    if (c.needsSetup) notes.push("card version not set: earn rates may be wrong");
    if (opts.abroad && fee > 0) notes.push(`${fee}% foreign transaction fee`);
    const valueTxt = value === 1 ? "" : ` at ${value}¢/pt`;
    return {
      cardId: c.id,
      name: c.name,
      multiplier: e.multiplier,
      returnPct,
      reason: `${e.multiplier}x on ${e.label}${valueTxt} ≈ ${returnPct.toFixed(1)}% back${opts.abroad && fee > 0 ? ` after the ${fee}% foreign fee` : ""}`,
      notes,
    };
  });
  picks.sort((a, b) => b.returnPct - a.returnPct || a.name.localeCompare(b.name));
  if (opts.abroad && picks.length > 1) {
    const best = picks[0];
    const bestCard = cards.find((c) => c.id === best.cardId)!;
    if ((bestCard.foreignFeePct ?? 3) > 0) {
      const noFee = picks.find((p) => (cards.find((c) => c.id === p.cardId)!.foreignFeePct ?? 3) === 0 && best.returnPct - p.returnPct <= 1);
      if (noFee) {
        picks.splice(picks.indexOf(noFee), 1);
        picks.unshift({ ...noFee, notes: [...noFee.notes, "no foreign fee, earns about the same"] });
      }
    }
  }
  return picks;
}

export function categoryFor(kind: string): SpendCategory {
  return (["flight", "hotel", "ticket", "food", "ground"].includes(kind) ? kind : "other") as SpendCategory;
}
