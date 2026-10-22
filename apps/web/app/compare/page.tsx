import Link from "next/link";
import { bestAmount, lineTotal } from "@rave-run/core";
import { chooseOption } from "@/app/actions";
import { listTrips, type TripView } from "@/lib/data";
import { fmtRange, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

const KINDS = ["ticket", "flight", "hotel", "ground", "food", "other"] as const;

function Cell({ t, kind }: { t: TripView; kind: string }) {
  const items = t.items.filter((i) => i.kind === kind);
  if (!items.length) return <span className="muted">—</span>;
  const priced = items.filter((i) => lineTotal(i) != null);
  const sum = priced.reduce((s, i) => s + (lineTotal(i) ?? 0), 0);
  const states = new Set(items.map((i) => bestAmount(i).state));
  const tag = states.has("unpriced") ? "?" : states.has("estimate") ? "est" : states.has("quoted") ? "" : "✓";
  return (
    <span className="num" title={[...states].join(", ")}>
      {priced.length ? usd(sum) : "not priced"} {tag && <small>{tag}</small>}
    </span>
  );
}

export default async function Compare() {
  const trips = (await listTrips()).filter((t) => t.status !== "done");
  const slots = [...new Set(trips.map((t) => t.slot).filter((s): s is string => !!s))];

  return (
    <>
      <h1>Compare</h1>
      <p className="muted">
        Each option priced end to end from Boston. <small>est</small> = estimate, <small>?</small> = something still unpriced, <small>✓</small> = booked.
      </p>
      {slots.map((slot) => {
        const opts = trips
          .filter((t) => t.slot === slot)
          .sort((a, b) => a.totals.unpricedCount - b.totals.unpricedCount || a.totals.total - b.totals.total);
        const fully = opts.filter((t) => t.totals.unpricedCount === 0);
        const cheapest = fully[0]?.id;
        return (
          <section key={slot}>
            <h2>{slot}</h2>
            <div className="compare">
              {opts.map((t) => (
                <div key={t.id} className="card stripe" style={{ ["--stripe" as string]: t.color }}>
                  <div className="spread">
                    <Link href={`/trips/${t.id}`}><strong>{t.name}</strong></Link>
                    {t.status === "planned" && <span className="chip accent">chosen</span>}
                  </div>
                  <small>
                    {t.event ? `${t.event.city} · ` : ""}{fmtRange(t.arrive, t.depart)}
                  </small>
                  {t.event?.lineup.length ? <div><small>{t.event.lineup.slice(0, 4).join(", ")}</small></div> : null}
                  <table style={{ marginTop: 8 }}>
                    <tbody>
                      {KINDS.filter((k) => opts.some((o) => o.items.some((i) => i.kind === k))).map((k) => (
                        <tr key={k}><td className="kind">{k}</td><td><Cell t={t} kind={k} /></td></tr>
                      ))}
                      <tr><td><strong>Total</strong></td><td><strong className="num">{usd(t.totals.total)}</strong></td></tr>
                    </tbody>
                  </table>
                  <div className="row" style={{ marginTop: 8 }}>
                    {t.id === cheapest && fully.length > 1 && <span className="chip good">cheapest fully priced</span>}
                    {t.totals.unpricedCount > 0 && <span className="chip">{t.totals.unpricedCount} not priced</span>}
                    {t.traps.map((tr) => <span key={tr.id} className="chip warn">{tr.name}</span>)}
                    {t.clashes.map((c) => <span key={c.otherId} className={`chip ${c.kind === "overlap" ? "bad" : "warn"}`}>{c.message}</span>)}
                  </div>
                  {t.status !== "planned" && t.status !== "booked" && (
                    <form action={chooseOption} style={{ marginTop: 10 }}>
                      <input type="hidden" name="id" value={t.id} />
                      <button type="submit" className="ghost">Choose this one</button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {slots.length === 0 && <p className="muted">No compare groups yet. Give trips the same slot to compare them.</p>}
    </>
  );
}
