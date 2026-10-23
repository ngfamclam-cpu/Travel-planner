// Savings meter (spec §2.8, step 10): how much the paid data tier would have saved this month.

export interface SavingsRow {
  lineItemId: string;
  date: string; // YYYY-MM-DD
  freeBest: number | null;
  paidBest: number | null;
}

export interface SavingsSummary {
  month: string; // YYYY-MM
  /** Sum over items of what the paid source found cheaper (latest comparison per item this month). */
  wouldHaveSaved: number;
  comparisons: number;
  itemsCheaper: number;
  paidTierCost: number;
  /** Suggest upgrading only when the savings beat the cost (spec). */
  suggestUpgrade: boolean;
}

export const PAID_TIER_COST = 25;

export function savingsThisMonth(rows: SavingsRow[], month: string, paidTierCost = PAID_TIER_COST): SavingsSummary {
  const latest = new Map<string, SavingsRow>();
  for (const r of rows.filter((x) => x.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date))) latest.set(r.lineItemId, r);
  let saved = 0;
  let cheaper = 0;
  for (const r of latest.values()) {
    if (r.freeBest == null || r.paidBest == null) continue;
    const d = r.freeBest - r.paidBest;
    if (d > 0) {
      saved += d;
      cheaper++;
    }
  }
  const wouldHaveSaved = Math.round(saved * 100) / 100;
  return { month, wouldHaveSaved, comparisons: latest.size, itemsCheaper: cheaper, paidTierCost, suggestUpgrade: wouldHaveSaved > paidTierCost };
}
