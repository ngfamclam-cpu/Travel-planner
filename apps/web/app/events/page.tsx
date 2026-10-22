import Link from "next/link";
import { eventClashes, toISODate, type TripLike } from "@rave-run/core";
import { addTripForEvent, createEvent } from "@/app/actions";
import { listEvents, listTrips } from "@/lib/data";
import { fmtDay } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Discover({ searchParams }: { searchParams: Promise<{ region?: string; month?: string }> }) {
  const { region = "all", month = "" } = await searchParams;
  const [events, trips] = await Promise.all([listEvents(), listTrips()]);
  const tripLikes: TripLike[] = trips.map((t) => ({ id: t.id, name: t.name, status: t.status, arrive: t.arrive, depart: t.depart }));
  const today = toISODate(new Date());
  const rows = events
    .map((e) => ({ ...e, start: toISODate(e.startDate), end: toISODate(e.endDate) }))
    .filter((e) => e.end >= today)
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
        <button type="submit" className="ghost">Filter</button>
      </form>
      <p className="muted">Live discovery (Ticketmaster, Edmtrain) arrives in build step 5. These are the seeded events.</p>

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
              {e.drivableFromBoston && <span className="chip good">drivable from Boston</span>}
              {e.datesTentative && <span className="chip warn">dates approximate</span>}
              {clashes.map((c) => <span key={c.id} className="chip bad">clashes with {c.name}</span>)}
              {e.notes && <small>{e.notes}</small>}
            </div>
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
