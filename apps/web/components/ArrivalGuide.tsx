import type { ArrivalGuideContent } from "@rave-run/core";
import { requestGuide } from "@/app/actions";
import { fmtWhen } from "@/lib/format";

export interface GuideRow {
  status: string;
  error: string | null;
  content: ArrivalGuideContent | null;
  generatedAt: Date | null;
  requestedAt: Date | null;
}

function Pick({ name, why, url, late }: { name: string; why: string; url?: string | null; late?: boolean }) {
  return (
    <li>
      {url ? <a href={url} target="_blank" rel="noreferrer">{name}</a> : <strong>{name}</strong>}
      {late && <> <span className="chip info">late night</span></>}
      <div><small>{why}</small></div>
    </li>
  );
}

export function ArrivalGuide({ tripId, guide, eligible }: { tripId: string; guide: GuideRow | null; eligible: boolean }) {
  const pending = !!guide?.requestedAt && (!guide.generatedAt || guide.requestedAt > guide.generatedAt);
  const button = (
    <form action={requestGuide}>
      <input type="hidden" name="tripId" value={tripId} />
      <button type="submit" className="ghost" disabled={pending}>{pending ? "Building… (a few minutes)" : guide?.content ? "Refresh guide" : "Build guide now"}</button>
    </form>
  );
  const c = guide?.content;
  return (
    <section className="card">
      <div className="spread">
        <h2 style={{ marginTop: 0 }}>Arrival guide</h2>
        {button}
      </div>
      {!c && (
        <p className="muted">
          {guide?.status === "error"
            ? `Couldn't build the guide: ${guide.error}`
            : eligible
              ? "Built automatically each week for planned trips, or tap Build guide now."
              : "Built automatically once this trip is planned, or tap Build guide now."}
        </p>
      )}
      {c && (
        <>
          {c.neighborhoods.length > 0 && (
            <>
              <h3>Neighborhoods</h3>
              <ul className="guide">{c.neighborhoods.map((n) => <li key={n.name}><strong>{n.name}</strong><div><small>{n.why}</small></div></li>)}</ul>
            </>
          )}
          <h3>Eat</h3>
          <ul className="guide">{c.food.map((f) => <Pick key={f.placeId} name={f.name} why={f.why} url={f.url} late={f.lateNight} />)}</ul>
          {c.todo.length > 0 && (
            <>
              <h3>Off-day plans</h3>
              <ul className="guide">{c.todo.map((t) => <Pick key={t.placeId} name={t.name} why={t.why} url={t.url} />)}</ul>
            </>
          )}
          <h3>Getting there</h3>
          <ul className="guide">{c.gettingThere.map((g, i) => <li key={i}><small>{g}</small></li>)}</ul>
          <h3>Festival survival</h3>
          <ul className="guide">{c.survival.map((s, i) => <li key={i}><small>{s}</small></li>)}</ul>
          <p className="muted" style={{ marginBottom: 0 }}>
            <small>
              Places from {c.placesSource} near {c.where.label}.{" "}
              {c.writtenBy === "claude" ? "Picks and notes written by Claude from that list (check hours before you go). " : c.note ? `${c.note}. ` : "Plain list. "}
              Updated {fmtWhen(guide?.generatedAt)}.
              {guide?.status === "error" && <> Last refresh failed: {guide.error}</>}
            </small>
          </p>
        </>
      )}
    </section>
  );
}
