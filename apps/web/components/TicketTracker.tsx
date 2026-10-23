import Link from "next/link";
import { TICKET_PLATFORMS } from "@rave-run/core";
import { logTicketPrice, saveTicketLink, setTicketTarget, toggleTicketWatch } from "@/app/actions";
import { Sparkline } from "@/components/Sparkline";
import type { EventTickets, TicketRow } from "@/lib/data";
import { fmtWhen, usd } from "@/lib/format";

const STATUS: Record<string, { text: string; cls: string }> = {
  ok: { text: "tracking", cls: "good" },
  needs_link: { text: "needs link", cls: "warn" },
  not_listed: { text: "not found", cls: "" },
  blocked: { text: "blocked: check manually", cls: "bad" },
  no_price: { text: "no price", cls: "" },
  error: { text: "error", cls: "bad" },
  manual: { text: "log by hand", cls: "" },
  not_configured: { text: "needs API key", cls: "warn" },
};

const ACCESS = { api: "API", page: "page check", manual: "manual" } as const;

function Row({ r, icon }: { r: TicketRow; icon: boolean }) {
  const st = STATUS[r.status] ?? { text: r.status, cls: "" };
  const q = r.latest;
  return (
    <div className={`li ${r.risky ? "risky" : ""}`} style={{ opacity: r.enabled ? 1 : 0.5 }}>
      <div className="li-head">
        <div style={{ flex: "1 1 200px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {icon && <img src={`/media/platform-${r.platform}-icon`} alt="" className="plat-icon" />}
          <strong>{r.name}</strong>{" "}
          <span className="chip">{ACCESS[r.access]}</span>{" "}
          <span className={`chip ${st.cls}`} title={r.lastError ?? undefined}>{st.text}</span>
          {r.risky && (
            <div className="alert bad" style={{ margin: "6px 0 0", padding: "6px 8px", fontSize: 13 }}>
              ⚠ Radiate is person-to-person: scam risk. Shown for reference only, never in totals or alerts.
            </div>
          )}
          {r.lastError && r.status !== "ok" && <div><small>{r.lastError}</small></div>}
        </div>
        <div className="li-price">
          {q ? (
            <>
              <div className="amt num">{usd(q.allIn)}</div>
              <small className="num">
                {q.feesEstimated ? `${usd(q.listed)} + est. fees` : "all-in"}
                {q.highestBid != null && <> · bid {usd(q.highestBid)}</>}
              </small>
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 4 }}>
                <span className="chip">{q.source}</span>
                {q.stale && <span className="chip bad">stale</span>}
              </div>
            </>
          ) : (
            <span className="muted">—</span>
          )}
        </div>
      </div>
      {q && (
        <small>
          {q.tierLabel ? `${q.tierLabel} · ` : ""}seen {fmtWhen(q.observedAt)}
          {q.note ? ` · “${q.note}”` : ""}
        </small>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        {r.url ? (
          <a href={r.url} target="_blank" rel="noreferrer">Open on {r.name} ↗</a>
        ) : (
          <a href={r.searchUrl} target="_blank" rel="noreferrer">Search {r.name} ↗</a>
        )}
        {r.url && <a href={r.searchUrl} target="_blank" rel="noreferrer"><small>search</small></a>}
      </div>
      {r.access !== "manual" && (
        <details>
          <summary>{r.url ? "Change link" : "Paste the event link"}</summary>
          <form action={saveTicketLink} className="row">
            <input type="hidden" name="watchId" value={r.watchId} />
            <input name="url" type="url" defaultValue={r.url ?? ""} placeholder={`https://${TICKET_PLATFORMS[r.platform].domain}/…`} style={{ flex: "1 1 240px" }} />
            <button type="submit" className="ghost">Save</button>
          </form>
          <form action={toggleTicketWatch} style={{ marginTop: 6 }}>
            <input type="hidden" name="watchId" value={r.watchId} />
            <button type="submit" className="ghost" style={{ fontSize: 12, padding: "4px 10px" }}>{r.enabled ? "Stop tracking here" : "Track here again"}</button>
          </form>
        </details>
      )}
    </div>
  );
}

export function TicketTracker({ t, showEventName = false, icons = new Set<string>() }: { t: EventTickets; showEventName?: boolean; icons?: Set<string> }) {
  const low = t.lowest;
  const underTarget = low && t.target != null && low.allIn <= t.target;
  return (
    <section className="card">
      <div className="spread">
        <h2 style={{ marginTop: 0 }}>
          {showEventName ? (t.tripId ? <Link href={`/trips/${t.tripId}`}>{t.eventName}</Link> : t.eventName) : "Tickets"}
        </h2>
        <div className="li-price">
          <div className="big num" style={{ fontSize: "1.4rem" }}>{low ? usd(low.allIn) : "—"}</div>
          <small>
            {low ? `lowest all-in · ${TICKET_PLATFORMS[low.platform].name}${low.feesEstimated ? " (est. fees)" : ""}` : "no prices yet"}
          </small>
        </div>
      </div>
      <div className="row">
        {t.target != null && <span className={`chip ${underTarget ? "good" : ""}`}>target {usd(t.target)}</span>}
        {t.tierHint && <span className="chip">{t.tierHint}</span>}
        <Sparkline points={t.history} />
      </div>

      {t.rows.map((r) => <Row key={r.watchId} r={r} icon={icons.has(r.platform)} />)}

      <details>
        <summary>🎯 Target price &amp; ticket type</summary>
        <form action={setTicketTarget} className="fields">
          <input type="hidden" name="eventId" value={t.eventId} />
          <div><label>Alert at or under (all-in)</label><input name="target" inputMode="decimal" defaultValue={t.target ?? ""} placeholder="e.g. 450" /></div>
          <div><label>Ticket type to compare</label><input name="tierHint" defaultValue={t.tierHint ?? ""} placeholder="e.g. 2-day GA" /></div>
          <div className="wide"><button type="submit">Save</button></div>
        </form>
      </details>
      <details>
        <summary>✍️ Log a price you saw</summary>
        <form action={logTicketPrice} className="fields">
          <input type="hidden" name="eventId" value={t.eventId} />
          <div>
            <label>Platform</label>
            <select name="platform" defaultValue="radiate">
              {Object.values(TICKET_PLATFORMS).map((p) => <option key={p.id} value={p.id}>{p.name}{p.risky ? " (scam risk)" : ""}</option>)}
            </select>
          </div>
          <div><label>Price</label><input name="price" inputMode="decimal" required /></div>
          <div><label>Tier</label><input name="tier" placeholder="GA, GA+, VIP…" /></div>
          <div><label>CrowdVolt bid (optional)</label><input name="highestBid" inputMode="decimal" /></div>
          <div className="wide"><label><input type="checkbox" name="feesIncluded" /> Price already includes fees</label></div>
          <div className="wide"><label>Link (optional)</label><input name="url" type="url" /></div>
          <div className="wide"><label>Note (optional)</label><input name="note" placeholder="e.g. seller has 40 vouches" /></div>
          <div className="wide"><button type="submit">Log price</button></div>
        </form>
      </details>
      <small className="muted">
        All-in = checkout total. When a site shows prices before fees, an estimated fee is added (edit the % in Settings). Page checks run once a day and can be blocked by a site.
        Nothing is bought here.
      </small>
    </section>
  );
}
