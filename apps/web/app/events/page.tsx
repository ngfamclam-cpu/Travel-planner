import Link from "next/link";
import { addDays, eventClashes, matchingArtists, toISODate, type TripLike } from "@rave-run/core";
import { addTripForEvent, createEvent, setEventSite, trackTickets } from "@/app/actions";
import { Thumb, mediaUrl } from "@/components/Thumb";
import { getSettings, listEvents, listTrips, type TripView } from "@/lib/data";
import { fmtDay } from "@/lib/format";

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 86_400_000;
const PALETTE = ["#a855f7", "#ec4899", "#06b6d4", "#f59e0b", "#22c55e", "#6366f1", "#ef4444", "#14b8a6"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Params = { region?: string; month?: string; show?: string; view?: string };
type Row = Awaited<ReturnType<typeof loadRows>>["rows"][number];

function colorFor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

function monthLabel(m: string): string {
  return new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function shiftMonth(m: string, n: number): string {
  const d = new Date(`${m}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

async function loadRows({ region, show }: { region: string; show: string }) {
  const [events, trips, settings] = await Promise.all([listEvents(), listTrips(), getSettings()]);
  const rows = events
    .map((e) => {
      const trip = trips.find((t) => t.event?.id === e.id);
      return {
        ...e,
        start: toISODate(e.startDate),
        end: toISODate(e.endDate),
        // "New" = found by live discovery in the last week (seeded events don't count).
        isNew: e.source !== "manual" && !e.source.includes("seed") && Date.now() - e.createdAt.getTime() < WEEK_MS,
        matches: matchingArtists(e.lineupHighlights, settings.favoriteArtists),
        heroUrl: mediaUrl(e.heroMediaId, `event-${e.id}-hero`),
        iconUrl: mediaUrl(e.iconMediaId, `event-${e.id}-icon`),
        color: trip?.color ?? colorFor(e.id),
      };
    })
    .filter((e) => show === "all" || (show === "mine" ? e.matches.length > 0 : e.isNew))
    .filter((e) => region === "all" || e.region === region);
  return { rows, trips };
}

function Filters({ p, months }: { p: Required<Params>; months: string[] }) {
  return (
    <form className="row" style={{ marginBottom: 12 }}>
      <input type="hidden" name="view" value={p.view} />
      <select name="region" defaultValue={p.region} style={{ width: "auto" }}>
        <option value="all">US + Asia</option>
        <option value="US">US</option>
        <option value="Asia">Asia</option>
      </select>
      <select name="month" defaultValue={p.month} style={{ width: "auto" }}>
        {p.view === "list" && <option value="">Any month</option>}
        {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
      </select>
      <select name="show" defaultValue={p.show} style={{ width: "auto" }}>
        <option value="all">All events</option>
        <option value="mine">Has my artists</option>
        <option value="new">New this week</option>
      </select>
      <button type="submit" className="ghost">Filter</button>
    </form>
  );
}

function EventCard({ e, trips }: { e: Row; trips: TripLike[] }) {
  const own = new Set(e.trips.map((t) => t.id));
  const clashes = eventClashes({ start: e.start, end: e.end }, trips.filter((t) => !own.has(t.id)));
  return (
    <div className="card event-card">
      <div className={`hero ${e.heroUrl ? "" : "hero-fallback"}`} style={e.heroUrl ? undefined : { background: `linear-gradient(135deg, ${e.color}, color-mix(in srgb, ${e.color} 30%, #0b0b12))` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {e.heroUrl && <img src={e.heroUrl} alt="" loading="lazy" />}
        {e.iconUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="hero-icon" src={e.iconUrl} alt="" loading="lazy" />
        )}
      </div>
      <div className="spread">
        <strong>{e.name}</strong>
        <small>{fmtDay(e.start, true)}{e.end !== e.start ? ` – ${fmtDay(e.end)}` : ""}</small>
      </div>
      <small>{e.venue && e.venue !== "TBA" ? `${e.venue}, ` : ""}{e.city}{e.country !== "US" ? `, ${e.country}` : ""}</small>
      <div className="row" style={{ marginTop: 6 }}>
        <span className="chip">{e.region}</span>
        {e.isNew && <span className="chip accent">new</span>}
        {e.matches.length > 0 && <span className="chip good">★ {e.matches.join(", ")}</span>}
        {e.drivableFromBoston && <span className="chip good">drivable from Boston</span>}
        {e.datesTentative && <span className="chip warn">dates approximate</span>}
        {clashes.map((c) => <span key={c.id} className="chip bad">clashes with {c.name}</span>)}
        {e.notes && <small>{e.notes}</small>}
      </div>
      {e.lineupHighlights.length > 0 && <div><small>{e.lineupHighlights.slice(0, 8).join(" · ")}</small></div>}
      <div className="row" style={{ marginTop: 4 }}>
        {e.officialUrl && <small><a href={e.officialUrl} target="_blank" rel="noreferrer">Official site ↗</a></small>}
        {e.edmtrainUrl && <small><a href={e.edmtrainUrl} target="_blank" rel="noreferrer">Edmtrain ↗</a></small>}
      </div>
      {e.ticketWatches.length === 0 && (
        <form action={trackTickets} style={{ marginTop: 8 }}>
          <input type="hidden" name="eventId" value={e.id} />
          <button type="submit" className="ghost" style={{ fontSize: 13, padding: "4px 10px" }}>🎟 Track tickets</button>
        </form>
      )}
      {e.ticketWatches.length > 0 && <div style={{ marginTop: 6 }}><Link href="/tickets"><small>🎟 tracking tickets</small></Link></div>}
      {e.trips.length > 0 ? (
        <div style={{ marginTop: 8 }}><Link href={`/trips/${e.trips[0]!.id}`}>Open trip →</Link></div>
      ) : (
        <form action={addTripForEvent} className="row" style={{ marginTop: 8 }}>
          <input type="hidden" name="eventId" value={e.id} />
          <input name="airports" placeholder="Airports, e.g. MCO" defaultValue={e.airports.join(" ")} style={{ width: 170 }} />
          <button type="submit" className="ghost">Plan a trip</button>
        </form>
      )}
      <details style={{ marginTop: 8 }}>
        <summary><small>{e.officialUrl ? "Change official site" : "Add official site"} (for pictures)</small></summary>
        <form action={setEventSite} className="row" style={{ marginTop: 6 }}>
          <input type="hidden" name="eventId" value={e.id} />
          <input name="officialUrl" placeholder="e.g. edclasvegas.com" defaultValue={e.officialUrl ?? ""} style={{ width: 220 }} />
          <button type="submit" className="ghost">Save</button>
        </form>
        <small className="muted">The banner and logo are fetched from the site within a few minutes.</small>
      </details>
    </div>
  );
}

/** Gives each span a row in its week so multi-day bars stay on one line. */
function lanes<T extends { id: string; from: string; to: string }>(items: T[], weekStart: string): T[][] {
  const weekEnd = addDays(weekStart, 6);
  const rows: T[][] = [];
  for (const it of items.filter((x) => x.from <= weekEnd && x.to >= weekStart).sort((a, b) => a.from.localeCompare(b.from) || b.to.localeCompare(a.to))) {
    const free = rows.find((r) => r.every((o) => o.to < it.from || o.from > it.to));
    if (free) free.push(it);
    else rows.push([it]);
  }
  return rows;
}

function Calendar({ month, rows, trips }: { month: string; rows: Row[]; trips: TripView[] }) {
  const first = `${month}-01`;
  const lead = new Date(`${first}T00:00:00Z`).getUTCDay();
  const gridStart = addDays(first, -lead);
  const next = `${shiftMonth(month, 1)}-01`;
  const weeks = Math.ceil((lead + (new Date(`${next}T00:00:00Z`).getTime() - new Date(`${first}T00:00:00Z`).getTime()) / 86_400_000) / 7);
  const today = toISODate(new Date());
  const tripSpans = trips.filter((t) => t.status !== "done").map((t) => ({ ...t, from: t.arrive, to: t.depart }));
  const evSpans = rows.map((e) => ({ ...e, from: e.start, to: e.end }));
  return (
    <div className="cal" role="grid" aria-label={monthLabel(month)}>
      {WEEKDAYS.map((w) => <div key={w} className="cal-head">{w}</div>)}
      {Array.from({ length: weeks }, (_, w) => {
        const ws = addDays(gridStart, w * 7);
        const tripRows = lanes(tripSpans, ws);
        const evRows = lanes(evSpans, ws);
        return Array.from({ length: 7 }, (_, i) => {
          const d = addDays(ws, i);
          const inMonth = d.slice(0, 7) === month;
          return (
            <div key={d} className={`cal-day ${inMonth ? "" : "out"} ${d === today ? "today" : ""}`}>
              <div className="cal-num">{Number(d.slice(8))}</div>
              {tripRows.map((lane, li) => {
                const t = lane.find((x) => x.from <= d && x.to >= d);
                if (!t) return <span key={li} className="cal-gap trip" />;
                return (
                  <Link
                    key={li}
                    href={`/trips/${t.id}`}
                    className={`cal-trip ${t.status === "considering" ? "maybe" : ""} ${t.arrive === d ? "first" : ""} ${t.depart === d ? "last" : ""}`}
                    style={{ ["--c" as string]: t.color }}
                    title={`${t.name} (${t.status}) · travel ${t.arrive} → ${t.depart}`}
                  >
                    {(t.arrive === d || i === 0) && <span>{t.name}</span>}
                  </Link>
                );
              })}
              {evRows.map((lane, li) => {
                const e = lane.find((x) => x.from <= d && x.to >= d);
                if (!e) return <span key={li} className="cal-gap ev" />;
                return (
                  <a key={li} href={`#ev-${e.id}`} className={`cal-ev ${e.start === d ? "first" : ""} ${e.end === d ? "last" : ""}`} style={{ ["--c" as string]: e.color }} title={`${e.name} · ${e.city}`}>
                    {e.start === d || i === 0 ? (
                      <>
                        {e.iconUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={e.iconUrl} alt="" />
                        ) : (
                          <i />
                        )}
                        <span>{e.name}</span>
                      </>
                    ) : (
                      <i className="cont" />
                    )}
                  </a>
                );
              })}
            </div>
          );
        });
      })}
    </div>
  );
}

export default async function Discover({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const view = sp.view === "calendar" ? "calendar" : "list";
  const region = sp.region ?? "all";
  const show = sp.show ?? "all";
  const today = toISODate(new Date());
  const { rows: all, trips } = await loadRows({ region, show });
  const tripLikes: TripLike[] = trips.map((t) => ({ id: t.id, name: t.name, status: t.status, arrive: t.arrive, depart: t.depart }));
  const months = [...new Set([today.slice(0, 7), ...all.map((e) => e.start.slice(0, 7))].filter((m) => m >= today.slice(0, 7)))].sort();
  const valid = (m?: string) => !!m && /^\d{4}-\d{2}$/.test(m);
  const month = view === "calendar" ? (valid(sp.month) ? sp.month! : today.slice(0, 7)) : valid(sp.month) ? sp.month! : "";
  if (month && !months.includes(month)) months.push(month), months.sort();
  const p = { view, region, show, month } as Required<Params>;
  const href = (o: Partial<Params>) => `/events?${new URLSearchParams({ ...p, ...o } as Record<string, string>).toString()}`;

  const upcoming = all.filter((e) => e.end >= today);
  const inMonth = (e: Row, m: string) => e.start.slice(0, 7) <= m && e.end.slice(0, 7) >= m;
  const rows = view === "calendar" ? all.filter((e) => inMonth(e, month)) : upcoming.filter((e) => !month || inMonth(e, month));

  return (
    <>
      <div className="spread">
        <h1>Discover</h1>
        <div className="seg" role="tablist">
          <Link href={href({ view: "list", month: "" })} className={view === "list" ? "on" : ""}>☰ List</Link>
          <Link href={href({ view: "calendar", month: month || today.slice(0, 7) })} className={view === "calendar" ? "on" : ""}>📅 Calendar</Link>
        </div>
      </div>
      <Filters p={p} months={months} />

      {view === "calendar" && (
        <>
          <div className="spread" style={{ marginBottom: 8 }}>
            <Link href={href({ month: shiftMonth(month, -1) })} className="ghost-link">← {monthLabel(shiftMonth(month, -1)).split(" ")[0]}</Link>
            <strong style={{ fontSize: "1.15rem" }}>{monthLabel(month)}</strong>
            <span className="row">
              {month !== today.slice(0, 7) && <Link href={href({ month: today.slice(0, 7) })} className="ghost-link">Today</Link>}
              <Link href={href({ month: shiftMonth(month, 1) })} className="ghost-link">{monthLabel(shiftMonth(month, 1)).split(" ")[0]} →</Link>
            </span>
          </div>
          <Calendar month={month} rows={rows} trips={trips} />
          <div className="row" style={{ margin: "8px 0 4px" }}>
            <small className="cal-key"><i className="cal-trip-key" /> your trip (travel days)</small>
            <small className="cal-key"><i className="cal-trip-key maybe" /> trip you're considering</small>
            <small className="cal-key"><i className="cal-ev-key" /> event</small>
          </div>
          <h2>{monthLabel(month)} · {rows.length} event{rows.length === 1 ? "" : "s"}</h2>
          {rows.length === 0 && <p className="muted">No events this month with these filters.</p>}
        </>
      )}

      {view === "list" && (
        <p className="muted">
          New US festivals are found every Monday from Edmtrain and Ticketmaster (needs their free keys; see Keys). Your artist list is in{" "}
          <Link href="/settings#artists">Settings</Link>.
        </p>
      )}

      <div className="event-grid">
        {rows.map((e) => (
          <div key={e.id} id={`ev-${e.id}`}>
            <EventCard e={e} trips={tripLikes} />
          </div>
        ))}
      </div>

      <details className="card" open={upcoming.length === 0}>
        <summary><strong>+ Add an event</strong> (creates a trip: arrive the day before, leave the day after)</summary>
        <form action={createEvent} className="fields">
          <div className="wide"><label>Name</label><input name="name" required /></div>
          <div><label>City</label><input name="city" required /></div>
          <div><label>Country code</label><input name="country" defaultValue="US" maxLength={2} /></div>
          <div><label>Start</label><input name="start" type="date" required /></div>
          <div><label>End</label><input name="end" type="date" /></div>
          <div><label>Venue</label><input name="venue" /></div>
          <div><label>Airports</label><input name="airports" placeholder="e.g. MIA FLL" /></div>
          <div><label>Compare group (optional)</label><input name="slot" placeholder="e.g. NYE 2026" /></div>
          <div><label>Official URL</label><input name="officialUrl" type="url" /></div>
          <div className="wide"><button type="submit">Add event + trip</button></div>
        </form>
      </details>
    </>
  );
}
