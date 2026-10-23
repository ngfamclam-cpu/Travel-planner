import Link from "next/link";
import { AIRPORT_CITY, HOTEL_TIER_LABEL, googleFlightsUrl } from "@rave-run/core";
import { chooseDates } from "@/app/actions";
import type { TripCards } from "@/lib/data";
import { fmtDay, fmtWhen, usd } from "@/lib/format";

/** Google Flights-style row of date options, each priced end to end. */
export function DateCards({ tripId, data }: { tripId: string; data: TripCards }) {
  const { tier, tiers, cards, cheapestTotal } = data;
  const anyPriced = cards.some((c) => c.price.complete);
  return (
    <section className="card">
      <div className="spread">
        <h2 style={{ marginTop: 0 }}>Dates</h2>
        <small>{cards.length} options · cheapest first</small>
      </div>
      <div className="row" style={{ marginBottom: 10 }} role="tablist" aria-label="Hotel pick">
        {tiers.map((t) => (
          <Link key={t} href={`/trips/${tripId}?tier=${t}`} className={`chip ${t === tier ? "accent" : ""}`} role="tab" aria-selected={t === tier} scroll={false}>
            🏨 {HOTEL_TIER_LABEL[t]}
          </Link>
        ))}
      </div>
      {!anyPriced && (
        <p className="muted" style={{ marginTop: 0 }}>
          No date has every price yet. Cards fill in as the worker checks flights and hotels for each date.
        </p>
      )}
      <div className="datecards">
        {cards.map(({ card, price }) => {
          const isCheapest = cheapestTotal != null && price.complete && !price.estimated && price.total === cheapestTotal;
          const delta = cheapestTotal != null && price.complete && !isCheapest ? price.total - cheapestTotal : null;
          const h = price.hotel;
          return (
            <div key={`${card.arrive}_${card.depart}`} className={`datecard ${card.isChosen ? "chosen" : ""} ${isCheapest ? "best" : ""}`}>
              <div className="row" style={{ minHeight: 24 }}>
                {isCheapest && <span className="chip good">cheapest</span>}
                {card.isChosen && <span className="chip accent">your dates</span>}
                {card.arrivesOnDayOne && <span className="chip warn" title="Lands the day the event starts">arrive day 1</span>}
                {price.stale && <span className="chip bad">stale</span>}
              </div>
              <div className="dc-dates">
                {fmtDay(card.arrive)} → {fmtDay(card.depart)}
              </div>
              <small>{card.nights} nights</small>
              <div className="dc-total num">
                {price.complete ? usd(price.total) : <span className="muted">{usd(price.total)}+</span>}
              </div>
              <small className="num">
                {price.estimated ? "includes hotel estimate" : !price.complete ? `missing ${price.missing.join(", ")}` : delta != null ? `+${usd(delta)} vs cheapest` : " "}
              </small>
              <ul className="dc-lines">
                {card.needsFlight && (
                  <li>
                    <span>✈</span>
                    {card.flight ? (
                      <span>
                        <strong className="num">{usd(card.flight.total)}</strong> {card.flight.origin}
                        {card.flight.positioningCost > 0 ? ` (+$${card.flight.positioningCost} to get there)` : ""} · {card.flight.carrier},{" "}
                        {card.flight.stops === 0 ? "nonstop" : `${card.flight.stops} stop`}
                      </span>
                    ) : (
                      <span className="muted">not checked yet</span>
                    )}
                  </li>
                )}
                {card.needsHotel && (
                  <li>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {h?.imageUrl ? <img src={h.imageUrl} alt="" className="hotel-photo" style={{ width: 18, height: 18, borderRadius: 4 }} loading="lazy" referrerPolicy="no-referrer" /> : <span>🏨</span>}
                    {h ? (
                      <span>
                        <strong className="num">{usd(h.total)}</strong> {h.url ? <a href={h.url} target="_blank" rel="noreferrer">{h.name}</a> : h.name}{" "}
                        <small>
                          {h.stars ? `${h.stars}★` : ""} {h.rating5 ? `${h.rating5}/5` : ""} · {usd(h.perNight)}/n
                        </small>
                      </span>
                    ) : price.estimated ? (
                      <span><strong className="num">{usd(card.hotelEstimate)}</strong> <small className="muted">estimate (not checked)</small></span>
                    ) : (
                      <span className="muted">{HOTEL_TIER_LABEL[tier]}: not checked for these nights</span>
                    )}
                  </li>
                )}
                {card.ticket && (
                  <li>
                    <span>🎟</span>
                    <span>
                      <strong className="num">{usd(card.ticket.price)}</strong> {card.ticket.label}
                      {card.ticket.resale && !/resale/i.test(card.ticket.label) && <small> (resale)</small>}
                      {card.ticket.others.length > 0 && (
                        <><br /><small>{card.ticket.others.map((o) => `${o.label} ${usd(o.price)}`).join(" · ")}</small></>
                      )}
                    </span>
                  </li>
                )}
                {card.fixed > 0 && (
                  <li><span>＋</span><span><span className="num">{usd(card.fixed)}</span> <small>ground &amp; other</small></span></li>
                )}
              </ul>
              {data.flightSearch && (
                <a
                  href={googleFlightsUrl({
                    // From the airport that won this card (e.g. Providence), else home.
                    fromCity: (card.flight?.origin && AIRPORT_CITY[card.flight.origin]) || data.flightSearch.fromCity,
                    toCity: data.flightSearch.toCity,
                    outboundDate: card.arrive,
                    returnDate: card.depart,
                  })}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 13 }}
                >
                  ✈ Google Flights for these dates ↗
                </a>
              )}
              {(card.flight || h) && (
                <small className="muted">
                  checked {fmtWhen(new Date(Math.min(...[card.flight?.fetchedAt, h?.fetchedAt].filter((x): x is Date => !!x).map((x) => x.getTime()))))}
                </small>
              )}
              {card.isChosen && tier === data.savedTier ? (
                <div className="chip accent" style={{ marginTop: "auto", justifyContent: "center", padding: 10 }}>✓ Selected</div>
              ) : (
              <form action={chooseDates} style={{ marginTop: "auto", paddingTop: 8 }}>
                <input type="hidden" name="tripId" value={tripId} />
                <input type="hidden" name="arrive" value={card.arrive} />
                <input type="hidden" name="depart" value={card.depart} />
                <input type="hidden" name="tier" value={tier} />
                <button type="submit" className={card.isChosen ? "ghost" : ""} style={{ width: "100%" }}>
                  {card.isChosen ? `Switch to ${HOTEL_TIER_LABEL[tier]}` : "Use these dates"}
                </button>
              </form>
              )}
            </div>
          );
        })}
      </div>
      <small className="muted">Choosing a card sets the trip's dates and hotel pick. Nothing is booked.</small>
    </section>
  );
}
