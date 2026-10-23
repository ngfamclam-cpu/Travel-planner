// Line item and trip totals. Amounts are per unit; total = amount × qty.

export type PriceState = "booked" | "quoted" | "estimate" | "unpriced";

export interface LineItemAmounts {
  estAmount: number | null;
  quotedAmount: number | null;
  bookedAmount: number | null;
  qty: number;
  /** false = left out of totals (shown, not counted). Defaults to included. */
  included?: boolean;
}

export function bestAmount(li: LineItemAmounts): { unit: number | null; state: PriceState } {
  if (li.bookedAmount != null) return { unit: li.bookedAmount, state: "booked" };
  if (li.quotedAmount != null) return { unit: li.quotedAmount, state: "quoted" };
  if (li.estAmount != null) return { unit: li.estAmount, state: "estimate" };
  return { unit: null, state: "unpriced" };
}

export function lineTotal(li: LineItemAmounts): number | null {
  const { unit } = bestAmount(li);
  return unit == null ? null : round2(unit * li.qty);
}

export interface TripTotals {
  total: number;
  booked: number;
  quoted: number;
  estimated: number;
  unpricedCount: number;
  /** Priced items switched off by the user (not in total). */
  excluded: number;
  excludedCount: number;
}

export function tripTotals(items: LineItemAmounts[]): TripTotals {
  const t: TripTotals = { total: 0, booked: 0, quoted: 0, estimated: 0, unpricedCount: 0, excluded: 0, excludedCount: 0 };
  for (const li of items) {
    const { unit, state } = bestAmount(li);
    if (li.included === false) {
      t.excludedCount++;
      if (unit != null) t.excluded += unit * li.qty;
      continue;
    }
    if (unit == null) {
      t.unpricedCount++;
      continue;
    }
    const amt = unit * li.qty;
    t.total += amt;
    if (state === "booked") t.booked += amt;
    else if (state === "quoted") t.quoted += amt;
    else t.estimated += amt;
  }
  t.total = round2(t.total);
  t.booked = round2(t.booked);
  t.quoted = round2(t.quoted);
  t.estimated = round2(t.estimated);
  t.excluded = round2(t.excluded);
  return t;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatUSD(n: number | null | undefined, opts: { cents?: boolean } = {}): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  });
}
