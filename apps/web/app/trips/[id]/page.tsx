import Link from "next/link";
import { notFound } from "next/navigation";
import { HOTEL_TIER_LABEL, googleFlightsUrl, googleHotelsUrl, searchOrigins, surgeSentence } from "@rave-run/core";
import { addLineItem, deleteLineItem, deleteTrip, pinHotel, trackTickets, updateLineItem, updateTrip } from "@/app/actions";
import { AlertList } from "@/components/AlertList";
import { InsightChip, PriceTag, Provenance } from "@/components/PriceTag";
import { Sparkline } from "@/components/Sparkline";
import { DateCards } from "@/components/DateCards";
import { TicketTracker } from "@/components/TicketTracker";
import { eventTickets, getCards, getSettings, getTrip, openAlerts, tripDateCards, type LineItemView, type TripView } from "@/lib/data";
import { fmtDay, fmtRange, fmtWhen, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

function deepLink(t: TripView, li: LineItemView, origins: string[]): { href: string; text: string } | null {
  if (li.kind === "flight" && li.searchSpec?.destinations?.length) {
    return {
      href: googleFlightsUrl({ origins: li.searchSpec.origins ?? origins, destinations: li.searchSpec.destinations, outboundDate: t.arrive, returnDate: t.depart }),
      text: "Search Google Flights",
    };
  }
  if (li.kind === "hotel" && li.hotel?.location) {
    return { href: googleHotelsUrl(li.hotel.location, t.arrive, t.depart), text: "Search Google Hotels" };
  }
  if (li.kind === "ticket" && (t.event?.ticketUrl || t.event?.officialUrl)) {
    return { href: (t.event.ticketUrl ?? t.event.officialUrl)!, text: "Official tickets" };
  }
  return null;
}

function HotelDetails({ li }: { li: LineItemView }) {
  const h = li.hotel!;
  const b = h.booking;
  return (
    <div style={{ marginTop: 6 }}>
      <small>
        Searching: {h.location ?? <span style={{ color: "var(--bad)" }}>no area set (edit to add one)</span>} · free-cancellation rates only
      </small>
      {li.bookedAmount != null ? (
        <div>
          <small>
            Booked{b?.hotelName ? `: ${b.hotelName}` : ""}
            {b?.refundable
              ? ` · refundable${b.cancelBy ? ` until ${b.cancelBy}` : ""}, so it's re-checked daily for a cheaper same-or-better rate`
              : " · non-refundable, not re-checked"}
          </small>
        </div>
      ) : (
        <div><small>Tip: book a refundable rate early. It's re-checked daily and you'll get a rebook alert if it drops.</small></div>
      )}
      {h.pinnedName && (
        <div className="row" style={{ marginTop: 4 }}>
          <small>My hotel: <strong>{h.pinnedName}</strong> (priced on every date card)</small>
          <form action={pinHotel}>
            <input type="hidden" name="id" value={li.id} />
            <input type="hidden" name="name" value="" />
            <button type="submit" className="ghost" style={{ padding: "2px 8px", fontSize: 12 }}>Unpin</button>
          </form>
        </div>
      )}
      {h.includeRentals && <div><small>Also checking vacation rentals (Airbnb/VRBO-style listings on Google).</small></div>}
      {h.options.length > 0 && (
        <ul className="options">
          {h.options.map((o) => (
            <li key={o.tier}>
              <span>
                <small className="kind">{HOTEL_TIER_LABEL[o.tier]}</small>{" "}
                {o.url ? <a href={o.url} target="_blank" rel="noreferrer">{o.name}</a> : o.name}{" "}
                <small>
                  {o.stars ? `${o.stars}★` : ""} {o.rating5 ? `· ${o.rating5}/5` : ""} {o.refundable ? "· free cancel" : ""}
                </small>
                {o.tier !== "pinned" && o.tier !== "rental" && o.name !== h.pinnedName && (
                  <form action={pinHotel} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={li.id} />
                    <input type="hidden" name="name" value={o.name} />
                    <button type="submit" className="ghost" style={{ padding: "0 6px", fontSize: 11, marginLeft: 4 }}>📌 pin</button>
                  </form>
                )}
              </span>
              <span className="num">{usd(o.perNight)}/n · {usd(o.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LineItem({ t, li, cards, origins }: { t: TripView; li: LineItemView; cards: { id: string; name: string }[]; origins: string[] }) {
  const link = deepLink(t, li, origins);
  return (
    <div className="li">
      <div className="li-head">
        <div style={{ flex: "1 1 220px" }}>
          <div className="kind">{li.kind}</div>
          <strong>{li.label}</strong>
          <div className="row" style={{ marginTop: 6 }}>
            <InsightChip label={li.insightLabel} />
            {li.surge && (
              <span className={`chip ${li.surge.level === "surge" ? "bad" : li.surge.level === "elevated" ? "warn" : "good"}`} title={`Normal-week price ${usd(li.baselinePrice)}`}>
                {surgeSentence(li.kind, li.surge)}
              </span>
            )}
            {li.cardName && <span className="chip accent">{li.cardName}</span>}
            <span className="chip" title="Buy/wait signals arrive in build step 6">signal: pending</span>
          </div>
        </div>
        <PriceTag li={li} />
      </div>
      <div style={{ marginTop: 6 }}><Provenance li={li} /></div>
      {li.notes && <div><small>{li.notes}</small></div>}
      {li.hotel && <HotelDetails li={li} />}
      {(li.kind === "flight" || li.spark.length > 0) && (
        <div className="row" style={{ marginTop: 6 }}>
          <Sparkline points={li.spark} />
          {li.latestSnapshot && (
            <small>
              Last check {fmtWhen(li.latestSnapshot.fetchedAt)}
              {li.kind === "flight" && (
                <>
                  : {li.latestSnapshot.origin}, {li.latestSnapshot.carrier},{" "}
                  {li.latestSnapshot.stops === 0 ? "nonstop" : `${li.latestSnapshot.stops} stop`} ({li.latestSnapshot.variant})
                </>
              )}
            </small>
          )}
        </div>
      )}
      {link && (
        <div style={{ marginTop: 6 }}>
          <a href={link.href} target="_blank" rel="noreferrer">{link.text} ↗</a> <small>(opens the search; nothing is bought here)</small>
        </div>
      )}
      <details>
        <summary>Edit</summary>
        <form action={updateLineItem} className="fields">
          <input type="hidden" name="id" value={li.id} />
          <div className="wide"><label>Label</label><input name="label" defaultValue={li.label} /></div>
          <div><label>Estimate (per unit)</label><input name="estAmount" inputMode="decimal" defaultValue={li.estAmount ?? ""} /></div>
          <div><label>Quoted (per unit)</label><input name="quotedAmount" inputMode="decimal" defaultValue={li.quotedAmount ?? ""} /></div>
          <div><label>Booked (per unit)</label><input name="bookedAmount" inputMode="decimal" defaultValue={li.bookedAmount ?? ""} /></div>
          <div><label>Qty / nights</label><input name="qty" inputMode="numeric" defaultValue={li.qty} /></div>
          <div className="wide"><label>Quote source (used if you change the quoted price)</label><input name="quotedSource" placeholder="e.g. hotels.com, Oct 22" /></div>
          <div className="wide">
            <label>Card</label>
            <select name="cardId" defaultValue={cards.find((c) => c.name === li.cardName)?.id ?? ""}>
              <option value="">—</option>
              {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {li.hotel && (
            <>
              <div className="wide">
                <label>Hotel search area</label>
                <input name="hotelQuery" defaultValue={li.hotel.customLocation ?? ""} placeholder={li.hotel.location ?? "e.g. hotels in Brickell, Miami"} />
              </div>
              <div className="wide">
                <label>My hotel: price a specific hotel on every date card</label>
                <input name="pinnedHotel" defaultValue={li.hotel.pinnedName ?? ""} placeholder="e.g. EAST Miami" />
              </div>
              <div className="wide">
                <label><input type="checkbox" name="includeRentals" defaultChecked={li.hotel.includeRentals} /> Also check vacation rentals (Airbnb/VRBO-style)</label>
              </div>
              <fieldset className="wide">
                <legend>If booked: what you booked (used for rebook alerts)</legend>
                <div className="fields">
                  <div className="wide"><label>Hotel name</label><input name="bookedHotelName" defaultValue={li.hotel.booking?.hotelName ?? ""} /></div>
                  <div><label>Stars</label><input name="bookedStars" inputMode="decimal" defaultValue={li.hotel.booking?.stars ?? ""} /></div>
                  <div><label>Rating (/5)</label><input name="bookedRating5" inputMode="decimal" defaultValue={li.hotel.booking?.rating5 ?? ""} /></div>
                  <div><label>Free cancel until</label><input name="cancelBy" type="date" defaultValue={li.hotel.booking?.cancelBy ?? ""} /></div>
                  <div><label>Confirmation #</label><input name="confirmation" defaultValue={li.hotel.booking?.confirmation ?? ""} /></div>
                  <div className="wide"><label><input type="checkbox" name="bookedRefundable" defaultChecked={li.hotel.booking?.refundable ?? true} /> Refundable (keep checking for cheaper rates)</label></div>
                </div>
              </fieldset>
            </>
          )}
          <div className="wide"><label>Notes</label><textarea name="notes" defaultValue={li.notes ?? ""} /></div>
          <div className="row wide"><button type="submit">Save</button></div>
        </form>
        <form action={deleteLineItem} style={{ marginTop: 8 }}>
          <input type="hidden" name="id" value={li.id} />
          <button type="submit" className="danger">Delete item</button>
        </form>
      </details>
    </div>
  );
}

export default async function TripPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tier?: string }> }) {
  const { id } = await params;
  const { tier } = await searchParams;
  const [t, cards, settings, alerts, dateCards] = await Promise.all([getTrip(id), getCards(), getSettings(), openAlerts(id), tripDateCards(id, tier)]);
  if (!t) notFound();
  const origins = searchOrigins(settings);
  const tickets = t.event ? await eventTickets(t.event.id) : null;

  return (
    <>
      <section className="card stripe" style={{ ["--stripe" as string]: t.color }}>
        <div className="spread">
          <div>
            {t.slot && <small>{t.slot}</small>}
            <h1>{t.name}</h1>
          </div>
          <div className="li-price">
            <div className="big num">{usd(t.totals.total)}</div>
            {t.totals.unpricedCount > 0 && <small>+ {t.totals.unpricedCount} item{t.totals.unpricedCount > 1 ? "s" : ""} not priced</small>}
          </div>
        </div>
        <div className="row">
          <span className={`chip ${t.status === "booked" ? "good" : t.status === "planned" ? "accent" : ""}`}>{t.status}</span>
          <span className="chip">{fmtRange(t.arrive, t.depart)}</span>
          <span className="chip">{t.nights} nights · ±{t.flexDays}d flex</span>
        </div>
        {t.event && (
          <p style={{ marginBottom: 0 }}>
            <strong>{t.event.name}</strong>: {t.event.venue ? `${t.event.venue}, ` : ""}{t.event.city} · {fmtDay(t.event.start)}
            {t.event.end !== t.event.start ? ` – ${fmtDay(t.event.end)}` : ""}
            {t.event.lineup.length > 0 && <><br /><small>{t.event.lineup.join(" · ")}</small></>}
            {t.event.notes && <><br /><small>{t.event.notes}</small></>}
            {t.event.officialUrl && <><br /><a href={t.event.officialUrl} target="_blank" rel="noreferrer">Official site ↗</a></>}
          </p>
        )}
        {t.notes && <p className="muted" style={{ marginBottom: 0 }}>{t.notes}</p>}
      </section>

      <AlertList alerts={alerts} />
      {dateCards && dateCards.cards.length > 0 && <DateCards tripId={t.id} data={dateCards} />}
      {t.clashes.map((c) => (
        <div key={c.otherId} className={`alert ${c.kind === "overlap" ? "bad" : "warn"}`}>
          ⚠ {c.message}. <Link href={`/trips/${c.otherId}`}>Open {c.otherName}</Link>
        </div>
      ))}
      {t.traps.map((tr) => (
        <div key={tr.id} className="alert warn">📅 <strong>{tr.name}</strong>: {tr.note}</div>
      ))}

      <section className="card">
        <div className="spread">
          <h2 style={{ marginTop: 0 }}>Line items</h2>
          <small className="num">
            booked {usd(t.totals.booked)} · quoted {usd(t.totals.quoted)} · est {usd(t.totals.estimated)}
          </small>
        </div>
        {t.items.map((li) => <LineItem key={li.id} t={t} li={li} cards={cards} origins={origins} />)}
        <details>
          <summary>+ Add line item</summary>
          <form action={addLineItem} className="fields">
            <input type="hidden" name="tripId" value={t.id} />
            <div>
              <label>Kind</label>
              <select name="kind" defaultValue="other">
                {["flight", "hotel", "ticket", "ground", "food", "other"].map((k) => <option key={k}>{k}</option>)}
              </select>
            </div>
            <div><label>Label</label><input name="label" required /></div>
            <div><label>Estimate (per unit)</label><input name="estAmount" inputMode="decimal" /></div>
            <div><label>Qty</label><input name="qty" inputMode="numeric" defaultValue={1} /></div>
            <div className="wide"><label>Flight destination airports (for flights, e.g. MIA FLL)</label><input name="destinations" /></div>
            <div className="wide"><button type="submit">Add</button></div>
          </form>
        </details>
      </section>

      {tickets && tickets.rows.length > 0 && <TicketTracker t={tickets} />}
      {tickets && tickets.rows.length === 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Tickets</h2>
          <form action={trackTickets} className="row">
            <input type="hidden" name="eventId" value={tickets.eventId} />
            <span className="muted">Track this event's ticket prices across platforms.</span>
            <button type="submit">Start tracking</button>
          </form>
        </section>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Arrival guide</h2>
        <p className="muted">Food, things to do and getting to the venue arrive in build step 9.</p>
      </section>

      <details className="card">
        <summary><strong>Trip details</strong></summary>
        <form action={updateTrip} className="fields">
          <input type="hidden" name="id" value={t.id} />
          <div className="wide"><label>Name</label><input name="name" defaultValue={t.name} /></div>
          <div>
            <label>Status</label>
            <select name="status" defaultValue={t.status}>
              {["considering", "planned", "booked", "done"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div><label>Flex days (±)</label><input name="flexDays" type="number" min={0} max={3} defaultValue={t.flexDays} /></div>
          <div><label>Arrive</label><input name="arrive" type="date" defaultValue={t.arrive} /></div>
          <div><label>Depart</label><input name="depart" type="date" defaultValue={t.depart} /></div>
          <div className="wide"><label>Notes</label><textarea name="notes" defaultValue={t.notes ?? ""} /></div>
          <div className="wide"><button type="submit">Save trip</button></div>
        </form>
        <form action={deleteTrip} style={{ marginTop: 12 }}>
          <input type="hidden" name="id" value={t.id} />
          <button type="submit" className="danger">Delete trip</button>
        </form>
      </details>
    </>
  );
}
