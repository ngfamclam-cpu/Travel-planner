# Rave Run

A personal travel planner for EDM festival trips from Boston. It prices flights, hotels and tickets for the **actual event dates** (not route averages), shows how much of each trip is booked, quoted or still a guess, and builds toward a daily "buy now / wait" brief.

The app **never buys anything**. It links to the exact search or checkout page.

## Status

Following the build order in the spec:

| Step | What | Status |
|---|---|---|
| 1 | Repo, Docker Compose, Postgres, Prisma schema, seed data | ✅ |
| 2 | Trips + line items UI, editable estimates, totals, compare view | ✅ |
| 3 | Flight provider, daily snapshots, event-window dates, ±flex variants, surge baseline, sparklines | ✅ (needs `SERPAPI_KEY` for live prices) |
| 4 | Hotels for the exact nights, refundable-only, quality floors, surge, rebook alerts | ✅ (same `SERPAPI_KEY`) |
| + | Date cards: every date combination priced end to end, with a hotel pick per card | ✅ |
| + | Ticket tracker: Ticketmaster, SeatGeek, StubHub, Vivid Seats, DICE, RA, CrowdVolt (NYC), Radiate (logged, never counted) + alerts | ✅ |
| 5 | Edmtrain + live event discovery | next |
| 6 | Buy-signal engine | |
| 7 | Points & card engine | |
| 8 | Daily brief (push + email) | |
| 9 | Arrival guides | |
| 10 | Savings meter + paid tier | |

## How prices work

- **Event window:** a trip built from an event arrives the day before it starts and leaves the day after it ends. The worker also searches ±1–2 day variants. A variant may land on day one (marked **arrive day 1**) but always leaves the day after the last day or later, because shows run late.
- **Date cards:** the top of each trip page is a row of cards like Google Flights' date grid, one per date combination, sorted cheapest first. Each card is priced end to end: the cheapest flight for those dates, a hotel for those exact nights, the cheapest available ticket tier (face value on sale, else the resale floor), and fixed costs like shuttles. Switch the hotel pick with the chips: **Cheapest**, **Best value** (highest rated within 25% of the cheapest), **Best rated**, **My hotel** (pin any hotel and it's priced on every card), and **Rental** (Google's vacation rentals: Airbnb/VRBO-style listings). **Use these dates** sets the trip's dates and hotel pick, and the line items re-quote for exactly that choice. Cards stay anchored to the original window, so choosing one doesn't shift the grid.
- **All six airports at once:** BOS, PVD, MHT, JFK, EWR, LGA. Each airport's positioning cost (e.g. ~$60 to get to NYC) is added before comparing, so a cheaper JFK fare only wins if it's still cheaper after getting there.
- **Surge:** once a week the worker prices the same trip on a normal week (3 weeks away, skipping holidays and peak seasons) and shows "Flights are 1.4× normal for these dates".
- **Hotels:** priced for the trip's exact nights, free-cancellation rates only, 3★+ and rated 4.0/5+ (both editable in Settings). The trip page shows the top 3 options. Each hotel line item has an editable search area. The defaults are "near the venue", except EDC (the Strip, where the shuttles leave from) and Tokyo (Shinjuku).
- **Rebook alerts:** when you mark a hotel as booked, enter the hotel name, stars, rating, and the free-cancellation deadline. Every morning the worker looks for a cheaper free-cancellation rate at the same or a better hotel, with savings of at least $20 or 5%. You get one alert per stay, and it's replaced only when a bigger saving shows up.
- **Ticket tracker** (Tickets tab and every trip page): the lowest **all-in** price per platform, compared side by side, with a cross-platform history line.
  - **Sources:** Ticketmaster and SeatGeek through their official APIs. StubHub, Vivid Seats, DICE and Resident Advisor through a polite once-a-day look at the public event page. CrowdVolt is added automatically for NYC-area events and shows its lowest ask and highest bid.
  - **Page checks:** these follow robots.txt and identify themselves. A site can still block them or change its layout; the row then says "blocked: check manually" and the one-tap link still works.
  - **Finding event pages:** the worker finds each event's page once via a SerpApi Google search, or you can paste the link yourself.
  - **Fees:** sites that show prices before fees get an estimated fee % added (editable in Settings) and are marked "est. fees".
  - **Radiate** is person-to-person and app-only. Prices you log are shown in red as a scam risk and are never used in totals, date cards or alerts.
  - **Alerts:** at or under your target price, a new lowest anywhere ($15 / 5% or more), face value back on sale or sold out, and a CrowdVolt ask within $20 of the bid. You get one open alert per event and kind, replaced only by a better one.
  - **Date cards** use the cheapest fresh tracked price, or face value if cheaper. Resale prices older than 48h are ignored.
- **Seasonal traps** are flagged automatically: NYE week, Thanksgiving, US holiday weekends, Florida spring break, cherry blossom, Golden Week, Songkran, Lunar New Year.
- **Provenance:** every price shows **booked / quoted / estimate / not priced**, its source and when it was fetched. Quotes older than 48h are marked **stale**. If a source fails, the app says "couldn't check" and never reuses old numbers quietly.
- **Quota:** every card needs its own hotel search (plus one more each for My hotel and Rental), so a trip with ±2 flex days uses about 12–36 hotel searches per refresh. The $25/month SerpApi plan (1,000 searches) is the practical minimum for daily cards; set the number in Settings. The free SerpApi tier is small, so the worker spreads it over the month: base dates first, then flex variants and baselines, with the most urgent and stalest trips first. Identical searches are cached for 6 hours.

## Seed data (Oct 22, 2026)

- **Planned:** Ultra Miami (Mar 26–28), EDC Las Vegas Dusk (May 14–16).
- **NYE 2026 (compare):** HiJinx, Eternal, Lights All Night, Countdown, Decadence AZ, Decadence CO, Proper, NYC club. All considering.
- **Asia spring 2027 (compare):** Tokyo Option A (early March, placeholder dates) vs Option B (Mar 30–Apr 11, GMO Sonic).
- 27 discovery events (US + Asia), 6 cards (Strata and Freedom marked "needs setup"), transfer partner starting list.

Hotel nights follow the trip window. Ultra is 4 nights (Mar 25–29) and HiJinx 3 (Dec 29–Jan 1), where the spec's estimates assumed 3 and 2. Edit the qty on the trip page if you'll arrive later.

## Run locally

Needs Node 22 and Postgres 16.

```sh
cp .env.example .env                       # fill DATABASE_URL for local dev, e.g.
echo 'DATABASE_URL="postgresql://raverun:raverun@localhost:5432/raverun"' > packages/db/.env
npm install
npm run db:deploy && npm run db:seed       # npm run db:reset wipes data and reseeds
npm run dev                                # http://localhost:3000 (no password in dev unless APP_PASSWORD is set)
npm run worker:once                        # one flight run now (needs SERPAPI_KEY)
npm test                                   # unit tests; set TEST_DATABASE_URL to also run DB integration tests
```

## Deploy (DigitalOcean droplet)

1. Point a domain (or subdomain) at the droplet: **Networking → Domains → A record → droplet IP**.
2. On the droplet (Docker + Compose installed):
   ```sh
   git clone <this repo> rave-run && cd rave-run
   cp .env.example .env && nano .env      # DOMAIN, POSTGRES_PASSWORD, APP_PASSWORD, SESSION_SECRET, SERPAPI_KEY
   docker compose up -d --build
   ```
3. Open `https://your-domain`. Caddy gets the HTTPS certificate automatically. The worker applies migrations and seeds on first start, then checks flights daily at 5:10 AM ET, hotels at 5:40 AM ET and tickets at 6:20 AM ET.
4. On Android: Chrome → menu → **Install app**.

Logs: `docker compose logs -f worker`. Manual flight run: `docker compose exec worker npm run worker:once`.

## Layout

```
apps/web          Next.js App Router PWA (UI, server actions, single-password auth)
apps/worker       node-cron jobs (flights, hotels + rebook alerts, tickets + ticket alerts; brief later)
packages/core     pure logic: date windows, variants, surge, seasonal traps, clashes, totals, query planner
packages/providers one adapter per source behind a common interface; fail soft, never invent prices
packages/db       Prisma schema, migrations, seed, createTripFromEvent
```

## Open questions (also shown as a checklist on Home)

1. Citi Strata version? Any Chase Sapphire? Which Chase Freedom?
2. Points balances (Amex MR, Citi TYP, Chase UR)
3. Airline/hotel status
4. Brief time and channels
5. Asia: Tokyo or China? (pick in Compare)
6. NYE: HiJinx or an alternative? (pick in Compare)

API keys: see [docs/API_KEYS.md](docs/API_KEYS.md).
