import Link from "next/link";
import { eventClashes, matchingArtists, toISODate, type TripLike } from "@rave-run/core";
import { addTripForEvent, createEvent, trackTickets } from "@/app/actions";
import { getSettings, listEvents, listTrips } from "@/lib/data";
import { fmtDay } from "@/lib/format";

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 86_400_000;

export default async function Discover({ searchParams }: { searchParams: Promise<{ region?: string; month?: string; show?: string }> }) {
  const { region = "all", month = "", show = "all" } = await searchParams;
  const [events, trips, settings] = await Promise.all([listEvents(), listTrips(), getSettings()]);
  const tripLikes: TripLike[] = trips.map((t) => ({ id: t.id, name: t.name, status: t.status, arrive: t.arrive, depart: t.depart }));
  const today = toISODate(new Date());
  const rows = events
    .map((e) => ({
      ...e,
      start: toISODate(e.startDate),
      end: toISODate(e.endDate),
      // "New" = found by live discovery in the last week (seeded events don't count).
      isNew: e.source !== "manual" && !e.source.includes("seed") && Date.now() - e.createdAt.getTime() < WEEK_MS,
      matches: matchingArtists(e.lineupHighlights, settings.favoriteArtists),
    }))
    .filter((e) => e.end >= today)
    .filter((e) => show === "all" || (show === "mine" ? e.matches.length > 0 : e.isNew))
    .filter((e) => region === "all" || e.region === region)
    .filter((e) => !month || e.start.slice(0, 7) === month || e.end.slice(0, 7) === month);
  const months = [...new Set(events.map((e) => toISODate(e.startDate).slice(0, 7)).filter((m) => m >= today.slice(0, 7)))].sort();

  return (
    <>
      <h1>Discover</h1>
      <form className="row" style={{ marginBottom: 12 }}>
        <select name="region" defaultValue={region} style={{ width: "auto" }}>
          <option value="all">US + Asia</option>
          <option value="US">US</option>
          <option value="Asia">Asia</option>
        </select>
        <select name="month" defaultValue={month} style={{ width: "auto" }}>
          <option value="">Any month</option>
          {months.map((m) => <option key={m} value={m}>{new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}</option>)}
        </select>
        <select name="show" defaultValue={show} style={{ width: "auto" }}>
          <option value="all">All events</option>
          <option value="mine">Has my artists</option>
          <option value="new">New this week</option>
        </select>
        <button type="submit" className="ghost">Filter</button>
      </form>
      <p className="muted">
        New US festivals are found every Monday from Edmtrain and Ticketmaster (needs their free keys; see Keys). Your artist list is in{" "}
        <Link href="/settings#artists">Settings</Link>.
      </p>

      {rows.map((e) => {
        const own = new Set(e.trips.map((t) => t.id));
        const clashes = eventClashes({ start: e.start, end: e.end }, tripLikes.filter((t) => !own.has(t.id)));
        return (
          <div key={e.id} className="card">
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
            {e.edmtrainUrl && (
              <div><small><a href={e.edmtrainUrl} target="_blank" rel="noreferrer">Event on Edmtrain ↗</a></small></div>
            )}
            {e.ticketWatches.length === 0 && (
              <form action={trackTickets} style={{ marginTop: 8 }}>
                <input type="hidden" name="eventId" value={e.id} />
                <button type="submit" className="ghost" style={{ fontSize: 13, padding: "4px 10px" }}>🎟 Track tickets</button>
              </form>
            )}
            {e.ticketWatches.length > 0 && <div style={{ marginTop: 6 }}><Link href="/tickets"><small>🎟 tracking tickets</small></Link></div>}
            {e.trips.length > 0 ? (
              <div style={{ marginTop: 8 }}><Link href={`/trips/${e.trips[0].id}`}>Open trip →</Link></div>
            ) : (
              <form action={addTripForEvent} className="row" style={{ marginTop: 8 }}>
                <input type="hidden" name="eventId" value={e.id} />
                <input name="airports" placeholder="Airports, e.g. MCO" defaultValue={e.airports.join(" ")} style={{ width: 170 }} />
                <button type="submit" className="ghost">Plan a trip</button>
              </form>
            )}
          </div>
        );
      })}

      <details className="card" open={rows.length === 0}>
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
