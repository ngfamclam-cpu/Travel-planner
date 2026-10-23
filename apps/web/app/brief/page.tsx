import Link from "next/link";
import type { BriefPayload } from "@rave-run/core";
import { prisma } from "@rave-run/db";
import { usd } from "@/lib/format";

export const dynamic = "force-dynamic";

const SIG: Record<string, string> = { BUY_NOW: "good", WAIT: "warn", WATCH: "info" };
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${usd(Math.abs(n))}`;

export default async function BriefPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const [brief, recent] = await Promise.all([
    date && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? prisma.brief.findUnique({ where: { date: new Date(`${date}T00:00:00Z`) } })
      : prisma.brief.findFirst({ orderBy: { date: "desc" } }),
    prisma.brief.findMany({ orderBy: { date: "desc" }, take: 14, select: { date: true } }),
  ]);
  if (!brief?.payload) {
    return (
      <>
        <h1>Daily brief</h1>
        <p className="muted">
          No brief yet. It's built every morning at your brief time (Settings). To build one now:{" "}
          <code>docker compose exec worker npm run brief</code>
        </p>
      </>
    );
  }
  const p = brief.payload as unknown as BriefPayload;
  return (
    <>
      <div className="spread">
        <h1>Brief · {p.dateLabel}</h1>
        <small>
          {brief.sentEmail ? "emailed" : "not emailed"} · {brief.sentPush ? "pushed" : "not pushed"}
        </small>
      </div>

      <section className="card">
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5 }}>{brief.summary}</p>
        <small className="muted">{brief.summarySource === "claude" ? "Written by Claude from the numbers below (every number checked)" : "Plain summary"}</small>
      </section>

      {p.actions.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Action items</h2>
          {p.actions.map((a, i) => (
            <div key={i} className="li">
              <strong>{a.title}</strong>
              <div><small>{a.detail}</small></div>
              {a.url && <a href={a.url} target="_blank" rel="noreferrer"><small>Open ↗</small></a>}
            </div>
          ))}
        </section>
      )}

      {p.trips.map((t) => (
        <section key={t.url} className="card">
          <div className="spread">
            <h2 style={{ marginTop: 0 }}><Link href={t.url}>{t.name}</Link></h2>
            <div className="li-price">
              <div className="big num" style={{ fontSize: "1.3rem" }}>{usd(t.total)}</div>
              {t.change != null && <small className="num">{signed(t.change)} vs yesterday</small>}
            </div>
          </div>
          <small>{t.dates} · {t.daysAway} days away{t.notPriced ? ` · ${t.notPriced} not priced` : ""}</small>
          {t.items.map((i, k) => (
            <div key={k} className="li">
              <div className="spread">
                <span><span className="kind">{i.kind}</span> {i.label}</span>
                <span className="num">{i.amount == null ? "—" : usd(i.amount)}</span>
              </div>
              <div className="row">
                {i.signal && <span className={`chip ${SIG[i.signal] ?? ""}`} style={{ fontWeight: 700 }}>{i.signal.replace("_", " ")}</span>}
                <span className="chip">{i.state}</span>
                {i.lastChecked && <span className="chip bad">last checked {i.lastChecked}</span>}
              </div>
              {i.reason && <div><small>💡 {i.reason}</small></div>}
              {i.card && <div><small>💳 {i.card}</small></div>}
            </div>
          ))}
        </section>
      ))}

      {p.considering.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Still deciding</h2>
          {p.considering.map((c) => (
            <div key={c.group}>{c.group}: {c.options} options{c.cheapest ? `, cheapest fully priced: ${c.cheapest.name} at ${usd(c.cheapest.total)}` : ", none fully priced yet"}</div>
          ))}
        </section>
      )}

      {p.newEvents.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>New events</h2>
          {p.newEvents.map((e, i) => (
            <div key={i} className="li">
              <strong>{e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.name}</a> : e.name}</strong>, {e.city} · <small>{e.dates}</small>
              <div className="row">
                {e.artists.length > 0 && <span className="chip good">★ {e.artists.join(", ")}</span>}
                {e.clashesWith.map((c) => <span key={c} className="chip bad">clashes with {c}</span>)}
              </div>
            </div>
          ))}
        </section>
      )}

      {p.problems.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Couldn&apos;t check</h2>
          {p.problems.map((x, i) => <div key={i}><small>{x.source}: {x.note}</small></div>)}
        </section>
      )}

      {recent.length > 1 && (
        <p className="row">
          <small className="muted">Earlier:</small>
          {recent.map((r) => {
            const d = r.date.toISOString().slice(0, 10);
            return <Link key={d} href={`/brief?date=${d}`} className="chip">{d.slice(5)}</Link>;
          })}
        </p>
      )}
    </>
  );
}
