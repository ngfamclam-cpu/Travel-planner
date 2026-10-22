import type { SparkPoint } from "@/lib/data";

/** Tiny price-history line (spec §7). Server-rendered SVG, no client JS. */
export function Sparkline({ points, width = 120, height = 32 }: { points: SparkPoint[]; width?: number; height?: number }) {
  if (points.length < 2) {
    return <span className="muted" style={{ fontSize: 12 }}>{points.length === 1 ? "1 price point" : "no history yet"}</span>;
  }
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const pad = 3;
  const xy = points.map((p, i) => [
    pad + (i / (points.length - 1)) * (width - pad * 2),
    pad + (1 - (p.price - min) / span) * (height - pad * 2),
  ]);
  const last = xy[xy.length - 1];
  const trend = prices[prices.length - 1] - prices[0];
  const color = trend > 0 ? "var(--bad)" : trend < 0 ? "var(--good)" : "var(--muted)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Price history: low $${min}, high $${max}, now $${prices.at(-1)}`}>
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
    </svg>
  );
}
