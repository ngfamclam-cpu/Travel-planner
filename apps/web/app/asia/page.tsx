import Link from "next/link";
import {
  ASIA_CITIES,
  ASIA_ORIGINS,
  addDays,
  asiaCity,
  asiaConfig,
  asiaOptions,
  asiaOrigin,
  asiaPositioning,
  asiaWindow,
  cheapestDates,
  googleFlightsUrl,
  monthlyBest,
  priceBands,
  relativeAge,
  todayIn,
  type AsiaCityId,
  type AsiaOption,
  type AsiaOriginId,
} from "@rave-run/core";
import { saveAsiaWatch } from "@/app/actions";
import { asiaData } from "@/lib/data";
import { fmtDay, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

type Mode = "round" | "out" | "back";
type Params = { mode?: string; city?: string; from?: string; nights?: string; day?: string };

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "round", label: "Round trip", hint: "Cheapest way there and back (round trip, or two one-ways when that's cheaper)" },
  { id: "out", label: "Fly there", hint: "One-way to Asia, by departure date" },
  { id: "back", label: "Fly home", hint: "One-way back to Boston / New York, by the date you fly home" },
];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const k = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : `$${Math.round(v)}`);
const monthName = (m: string, style: "long" | "short" = "long") =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: style, year: style === "long" ? "numeric" : undefined, timeZone: "UTC" });

function months(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); ) {
    out.push(m);
    const d = new Date(`${m}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    m = d.toISOString().slice(0, 7);
  }
  return out;
}

function routeText(o: AsiaOption): string {
  const city = asiaCity(o.city)!.name;
  const from = asiaOrigin(o.origin)!.name;
  if (o.kind === "back") return `${city} → ${from}`;
  if (o.kind === "out") return `${from} → ${city}`;
  if (o.kind === "two_oneways") return `${from} → ${city} → ${asiaOrigin(o.homeTo ?? o.origin)!.name}`;
  return `${from} ⇄ ${city}`;
}

function links(o: AsiaOption): { label: string; href: string }[] {
  const city = asiaCity(o.city)!.name;
  const from = asiaOrigin(o.origin)!.name;
  if (o.kind === "round") return [{ label: "Google Flights", href: googleFlightsUrl({ fromCity: from, toCity: city, outboundDate: o.date, returnDate: o.returnDate }) }];
  if (o.kind === "out") return [{ label: "Google Flights", href: googleFlightsUrl({ fromCity: from, toCity: city, outboundDate: o.date }) }];
  if (o.kind === "back") return [{ label: "Google Flights", href: googleFlightsUrl({ fromCity: city, toCity: from, outboundDate: o.date }) }];
  return [
    { label: "Flight there", href: googleFlightsUrl({ fromCity: from, toCity: city, outboundDate: o.date }) },
    { label: "Flight home", href: googleFlightsUrl({ fromCity: city, toCity: asiaOrigin(o.homeTo ?? o.origin)!.name, outboundDate: o.returnDate! }) },
  ];
}

export default async function ExploreAsia({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const mode: Mode = sp.mode === "out" || sp.mode === "back" ? sp.mode : "round";
  const city = (ASIA_CITIES.some((c) => c.id === sp.city) ? sp.city : "all") as AsiaCityId | "all";
  const from = (ASIA_ORIGINS.some((o) => o.id === sp.from) ? sp.from : "any") as AsiaOriginId | "any";
  const { rows, settings, lastRun, lastFetched, noNonstop, scanned, demo } = await asiaData();
  const cfg = asiaConfig(settings);
  const nightsN = Number(sp.nights);
  const nights = mode === "round" && nightsN >= cfg.minNights && nightsN <= cfg.maxNights ? nightsN : ("any" as const);
  const today = todayIn();
  const win = asiaWindow(today, cfg.months);
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : null;

  const p = { mode, city, from, nights: String(nights) };
  const href = (o: Partial<Params>, hash = "") => {
    const q = new URLSearchParams({ ...p, ...o } as Record<string, string>);
    for (const [key, v] of [...q.entries()]) if (v === "any" || v === "all" || v === "" || (key === "mode" && v === "round")) q.delete(key);
    return `/asia${q.size ? `?${q}` : ""}${hash}`;
  };

  const options = asiaOptions(rows, settings, { mode, city, origin: from, nights });
  const best = new Map([...options.entries()].map(([d, l]) => [d, l[0]!]));
  const band = priceBands([...best.values()].map((o) => o.allIn));
  const monthList = months(win.from, win.to);
  // Per-city figures ignore the city filter so the tiles always compare all four.
  const allCities = asiaOptions(rows, settings, { mode, origin: from, nights });
  const monthly = monthlyBest(allCities);
  const top = cheapestDates(options, 5);
  // One entry per route (cheapest stay length first); the other stay lengths ride along as chips.
  const dayGroups = new Map<string, AsiaOption[]>();
  for (const o of day ? (options.get(day) ?? []) : []) {
    const key = `${o.kind}:${o.origin}:${o.homeTo ?? ""}:${o.city}`;
    dayGroups.set(key, [...(dayGroups.get(key) ?? []), o]);
  }
  const dayOptions = [...dayGroups.values()].slice(0, 10);
  const shownCities = ASIA_CITIES.filter((c) => city === "all" || c.id === city);
  const failing = lastRun && !lastRun.ok;

  return (
    <>
      <section className="asia-hero card">
        <div className="asia-hero-bg" aria-hidden>
          {ASIA_CITIES.map((c) => <span key={c.id} style={{ background: c.color }} />)}
        </div>
        <h1 style={{ margin: 0 }}>Explore Asia</h1>
        <p style={{ margin: "4px 0 0" }}>
          Nonstop from Boston or New York to Tokyo, Seoul, Shanghai and Hong Kong, for the next {cfg.months} months.{" "}
          <small className="muted">{lastFetched ? `Prices updated ${relativeAge(lastFetched)}; each date is re-checked every ${cfg.refreshDays} days.` : "No prices yet."}</small>
        </p>
      </section>

      {demo && rows.length > 0 && (
        <div className="alert bad"><strong>Demo data:</strong> these fares are fake, for trying the page. The real job replaces them on its next run (or clear everything with <code>npm run db:reset</code>).</div>
      )}
      {failing && (
        <div className="alert bad">
          Couldn&apos;t check fares on the last run ({relativeAge(lastRun.startedAt)}): {lastRun.error?.split("\n")[0]}. Older prices are still shown with their age.
        </div>
      )}
      {!cfg.enabled && <div className="alert warn">Tracking is off. Turn it on under <a href="#asia-settings">Tracking settings</a>.</div>}

      <div className="asia-tiles">
        {ASIA_CITIES.map((c) => {
          const vals = [...(monthly.get(c.id)?.values() ?? [])];
          const cheapest = vals.sort((a, b) => a.allIn - b.allIn)[0];
          const none = noNonstop.filter(([o, ct]) => ct === c.id && (from === "any" || o === from)).length === (from === "any" ? 2 : 1);
          return (
            <Link key={c.id} href={href({ city: city === c.id ? "all" : c.id, day: "" })} className={`asia-tile ${city === c.id ? "on" : ""}`} style={{ ["--c" as string]: c.color }}>
              <strong>{c.name}</strong>
              <small className="muted">{c.airports.join(" · ")}</small>
              {cheapest ? (
                <>
                  <span className="big num" style={{ fontSize: "1.3rem" }}>{usd(cheapest.allIn)}</span>
                  <small>from {fmtDay(cheapest.date)} · {asiaOrigin(cheapest.origin)!.id}</small>
                </>
              ) : (
                <small className="muted">{none || rows.length > 0 ? "no nonstop fares found" : "no prices yet"}</small>
              )}
            </Link>
          );
        })}
      </div>

      <div className="row" style={{ margin: "12px 0" }}>
        <div className="seg">
          {MODES.map((m) => (
            <Link key={m.id} href={href({ mode: m.id, day: "", nights: m.id === "round" ? String(nights) : "any" })} className={mode === m.id ? "on" : ""}>{m.label}</Link>
          ))}
        </div>
        <form className="row" action="/asia">
          {mode !== "round" && <input type="hidden" name="mode" value={mode} />}
          {city !== "all" && <input type="hidden" name="city" value={city} />}
          <select name="from" defaultValue={from} style={{ width: "auto" }}>
            <option value="any">Boston or NYC</option>
            {ASIA_ORIGINS.map((o) => <option key={o.id} value={o.id}>{o.id === "NYC" ? "New York (JFK/EWR)" : "Boston (BOS)"}</option>)}
          </select>
          {mode === "round" && (
            <select name="nights" defaultValue={String(nights)} style={{ width: "auto" }}>
              <option value="any">{cfg.minNights}–{cfg.maxNights} nights</option>
              {Array.from({ length: cfg.maxNights - cfg.minNights + 1 }, (_, i) => cfg.minNights + i).map((n) => <option key={n} value={n}>{n} nights</option>)}
            </select>
          )}
          <button type="submit" className="ghost">Apply</button>
        </form>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {MODES.find((m) => m.id === mode)!.hint}. Prices are per person in economy; New York fares include {usd(asiaPositioning(settings, "NYC", "round"))} to get there and back (Settings → Origin airports).
      </p>

      {rows.length === 0 ? (
        <section className="card">
          <strong>No fares yet.</strong>
          <p>
            The worker fills this calendar on its next run (it runs nightly, and right after it starts). The first fill is about {scanned ? "" : "140 "}calendar
            requests, spaced 5–8 seconds apart, so allow 15–20 minutes. It needs the <code>flights-free</code> service: after updating, rebuild with{" "}
            <code>docker compose -f docker-compose.local.yml up -d --build</code>.
          </p>
        </section>
      ) : (
        <>
          <h2>When to go</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="when">
              <thead>
                <tr>
                  <th />
                  {monthList.map((m) => <th key={m}>{monthName(m, "short")}</th>)}
                </tr>
              </thead>
              <tbody>
                {shownCities.map((c) => {
                  const row = monthly.get(c.id);
                  const min = Math.min(...[...(row?.values() ?? [])].map((o) => o.allIn));
                  return (
                    <tr key={c.id}>
                      <th style={{ textAlign: "left" }}><span className="dot" style={{ background: c.color }} /> {c.name}</th>
                      {monthList.map((m) => {
                        const o = row?.get(m);
                        return (
                          <td key={m} className={o && o.allIn === min ? "best" : ""}>
                            {o ? <Link href={href({ city: c.id, day: o.date }, "#day")} className="num">{k(o.allIn)}</Link> : <span className="muted">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <small className="muted">Cheapest date each month. Green = that city&apos;s best month. Tap a price to see the day.</small>
          </div>

          {top.length > 0 && (
            <div className="row" style={{ margin: "8px 0 4px" }}>
              <small className="muted">Cheapest dates:</small>
              {top.map((o) => (
                <Link key={o.date} href={href({ day: o.date }, "#day")} className="chip good">
                  {fmtDay(o.date)} · {asiaCity(o.city)!.name} · {usd(o.allIn)}
                </Link>
              ))}
            </div>
          )}

          {day && (
            <section className="card" id="day">
              <div className="spread">
                <h2 style={{ margin: 0 }}>{fmtDay(day, true)}</h2>
                <Link href={href({ day: "" })} className="ghost-link">Close</Link>
              </div>
              {dayOptions.length === 0 && <p className="muted">No nonstop fares for this date with these filters.</p>}
              {dayOptions.map(([o, ...more], i) => (
                <div key={i} className="asia-opt" style={{ ["--c" as string]: asiaCity(o!.city)!.color }}>
                  <div className="spread">
                    <strong>{routeText(o)}</strong>
                    <span className="num big" style={{ fontSize: "1.15rem" }}>{usd(o.allIn)}</span>
                  </div>
                  <div className="row">
                    <small>
                      {o.kind === "back" ? `Fly home ${fmtDay(o.date)}` : `${fmtDay(o.date)}${o.returnDate ? ` → ${fmtDay(o.returnDate)} · ${o.nights} nights` : " · one-way"}`}
                    </small>
                    {o.kind === "two_oneways" && <span className="chip accent">2 one-ways beat the round trip</span>}
                    {o.allIn !== o.fare && <small className="muted">fare {usd(o.fare)} + getting to NYC</small>}
                    {o.prevPrice != null && o.prevPrice !== o.fare && (
                      <span className={`chip ${o.fare < o.prevPrice ? "good" : "bad"}`}>{o.fare < o.prevPrice ? "↓" : "↑"} {usd(Math.abs(o.fare - o.prevPrice))} since last check</span>
                    )}
                    {o.lowPrice != null && o.lowPrice < o.fare && <small className="muted">lowest seen {usd(o.lowPrice)}</small>}
                    <small className="muted">checked {relativeAge(o.fetchedAt)}</small>
                  </div>
                  {more.length > 0 && (
                    <div className="row" style={{ marginTop: 4 }}>
                      <small className="muted">Other stays:</small>
                      {more.sort((a, b) => a.nights - b.nights).map((m) => (
                        <span key={m.nights} className="chip" title={`${fmtDay(m.date)} → ${fmtDay(m.returnDate!)}`}>{m.nights} nights {usd(m.allIn)}</span>
                      ))}
                    </div>
                  )}
                  <div className="row" style={{ marginTop: 4 }}>
                    {links(o!).map((l) => <a key={l.label} href={l.href} target="_blank" rel="noreferrer"><small>{l.label} ↗</small></a>)}
                  </div>
                </div>
              ))}
              <small className="muted">Links open Google Flights for those dates; set the Nonstop filter there. The app never books anything.</small>
            </section>
          )}

          <h2>Calendar</h2>
          <div className="row" style={{ marginBottom: 8 }}>
            <small className="fare-key b-low">cheap</small>
            <small className="fare-key b-fair">fair</small>
            <small className="fare-key b-high">pricey</small>
            <small className="fare-key b-peak">peak</small>
            <small className="muted">relative to everything shown · tap a day for options</small>
          </div>
          <div className="fare-months">
            {monthList.map((m) => {
              const first = `${m}-01`;
              const lead = new Date(`${first}T00:00:00Z`).getUTCDay();
              const count = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
              return (
                <div key={m} className="card fare-month">
                  <strong>{monthName(m)}</strong>
                  <div className="fare-cal">
                    {WEEKDAYS.map((w, i) => <span key={i} className="fare-head">{w}</span>)}
                    {Array.from({ length: lead }, (_, i) => <span key={`x${i}`} />)}
                    {Array.from({ length: count }, (_, i) => {
                      const d = addDays(first, i);
                      const o = best.get(d);
                      const inWin = d >= win.from && d <= win.to;
                      if (!o) {
                        return (
                          <span key={d} className={`fare-day empty ${inWin ? "" : "out"}`} title={inWin ? "No nonstop fare found" : undefined}>
                            <b>{i + 1}</b>
                          </span>
                        );
                      }
                      return (
                        <Link
                          key={d}
                          href={href({ day: d }, "#day")}
                          className={`fare-day b-${band(o.allIn)} ${d === day ? "sel" : ""}`}
                          title={`${fmtDay(d)}: ${usd(o.allIn)} · ${routeText(o)}`}
                        >
                          <b>{i + 1}</b>
                          <span className="num">{k(o.allIn)}</span>
                          {city === "all" && <i style={{ background: asiaCity(o.city)!.color }} />}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {city === "all" && (
            <div className="row" style={{ marginTop: 6 }}>
              {ASIA_CITIES.map((c) => <small key={c.id} className="cal-key"><span className="dot" style={{ background: c.color }} /> {c.name}</small>)}
              <small className="muted">dot = cheapest city that day</small>
            </div>
          )}
        </>
      )}

      {noNonstop.length > 0 && (
        <p className="muted">
          No nonstop found in the next {cfg.months} months:{" "}
          {noNonstop.map(([o, c]) => `${asiaOrigin(o)?.name ?? o} → ${asiaCity(c)?.name ?? c}`).join(", ")}.
        </p>
      )}

      <details className="card" id="asia-settings">
        <summary><strong>Tracking settings</strong></summary>
        <form action={saveAsiaWatch} className="fields">
          <div className="wide"><label><input type="checkbox" name="enabled" defaultChecked={cfg.enabled} style={{ width: "auto" }} /> Track Asia fares</label></div>
          <div><label>Shortest stay (nights)</label><input name="minNights" type="number" min={1} max={30} defaultValue={cfg.minNights} /></div>
          <div><label>Longest stay (nights)</label><input name="maxNights" type="number" min={1} max={30} defaultValue={cfg.maxNights} /></div>
          <div><label>Months ahead</label><input name="months" type="number" min={1} max={9} defaultValue={cfg.months} /></div>
          <div><label>Re-check every (days)</label><input name="refreshDays" type="number" min={1} max={14} defaultValue={cfg.refreshDays} /></div>
          <div><label>Requests per day</label><input name="dailyRequests" type="number" min={0} max={400} defaultValue={cfg.dailyRequests} /></div>
          <div className="wide">
            <small className="muted">
              Each request covers one route and stay length for up to 61 days. Right now a full refresh is{" "}
              {(cfg.maxNights - cfg.minNights + 3) * 2 * 4 * Math.ceil((cfg.months * 30.5) / 61)} requests, so about{" "}
              {Math.ceil(((cfg.maxNights - cfg.minNights + 3) * 2 * 4 * Math.ceil((cfg.months * 30.5) / 61)) / cfg.refreshDays)} a day. Free, via
              Google Flights&apos; price calendar; separate from your festival flight allowance.
            </small>
          </div>
          <div className="wide"><button type="submit">Save</button></div>
        </form>
      </details>
    </>
  );
}

