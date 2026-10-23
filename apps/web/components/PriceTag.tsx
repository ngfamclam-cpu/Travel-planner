import { bestAmount } from "@rave-run/core";
import type { LineItemView } from "@/lib/data";
import { fmtWhen, usd } from "@/lib/format";

const STATE_CHIP = {
  booked: { cls: "good", text: "booked" },
  quoted: { cls: "info", text: "quoted" },
  estimate: { cls: "warn", text: "estimate" },
  unpriced: { cls: "", text: "not priced" },
} as const;

/** Every price shows source, fetched time, and quoted vs estimate (spec §14). */
export function PriceTag({ li }: { li: LineItemView }) {
  const { unit, state } = bestAmount(li);
  const chip = STATE_CHIP[state];
  return (
    <div className="li-price">
      <div className="amt num">{unit == null ? "—" : usd(unit * li.qty, true)}</div>
      {li.qty > 1 && unit != null && <div className="muted num" style={{ fontSize: 12 }}>{usd(unit, true)} × {li.qty}</div>}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 4 }}>
        {li.included ? <span className={`chip ${chip.cls}`}>{chip.text}</span> : <span className="chip">not counted</span>}
        {state === "quoted" && li.quoteStale && <span className="chip bad" title="Older than 48 hours: needs a fresh check">stale</span>}
      </div>
    </div>
  );
}

export function Provenance({ li }: { li: LineItemView }) {
  const { state } = bestAmount(li);
  if (state === "booked") return <small>Booked price (entered by you).</small>;
  if (state === "quoted") {
    return (
      <small>
        Source: {li.quotedUrl ? <a href={li.quotedUrl} target="_blank" rel="noreferrer">{li.quotedSource ?? "link"}</a> : li.quotedSource ?? "unknown"} · {fmtWhen(li.quotedAt)}
        {li.estAmount != null && <> · est was {usd(li.estAmount)}</>}
      </small>
    );
  }
  if (state === "estimate") return <small>Estimate (no live price yet). Replaced by the first real snapshot.</small>;
  return <small>No price yet.</small>;
}

export function InsightChip({ label }: { label: string | null }) {
  if (!label) return null;
  const cls = label === "low" ? "good" : label === "high" ? "bad" : "info";
  return <span className={`chip ${cls}`} title="Google Flights price insight">Google: prices {label}</span>;
}
