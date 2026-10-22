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
| 4 | Hotels + surge + rebook alerts | next |
| 5 | Ticketmaster / Edmtrain / SeatGeek + discovery | |
| 6 | Buy-signal engine | |
| 7 | Points & card engine | |
| 8 | Daily brief (push + email) | |
| 9 | Arrival guides | |
| 10 | Savings meter + paid tier | |

## How prices work

- **Event window:** a trip built from an event arrives the day before it starts and leaves the day after it ends. The worker also searches ±1–2 day variants (never ones that miss part of the event) and keeps the cheapest.
- **All six airports at once:** BOS, PVD, MHT, JFK, EWR, LGA. Each airport's positioning cost (e.g. ~$60 to get to NYC) is added before comparing, so a cheaper JFK fare only wins if it's still cheaper after getting there.
- **Surge:** once a week the worker prices the same trip on a normal week (3 weeks away, skipping holidays and peak seasons) and shows "Flights are 1.4× normal for these dates".
- **Seasonal traps** are flagged automatically: NYE week, Thanksgiving, US holiday weekends, Florida spring break, cherry blossom, Golden Week, Songkran, Lunar New Year.
- **Provenance:** every price shows **booked / quoted / estimate / not priced**, its source and when it was fetched. Quotes older than 48h are marked **stale**. If a source fails, the app says "couldn't check" and never reuses old numbers quietly.
- **Quota:** the free SerpApi tier is small, so the worker spreads it over the month: base dates first, then flex variants and baselines, with the most urgent and stalest trips first. Identical searches are cached for 6 hours.

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
npm run db:deploy && npm run db:seed       # db:seed -- --reset to start over
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
3. Open `https://your-domain`. Caddy gets the HTTPS certificate automatically. The worker applies migrations and seeds on first start, then checks flights daily at 5:10 AM ET.
4. On Android: Chrome → menu → **Install app**.

Logs: `docker compose logs -f worker`. Manual flight run: `docker compose exec worker npm run worker:once`.

## Layout

```
apps/web          Next.js App Router PWA (UI, server actions, single-password auth)
apps/worker       node-cron jobs (flights now; hotels, events, brief later)
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
