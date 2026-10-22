# Try Rave Run on your computer

You need about 10 minutes and one of these:

- **Option A: Docker Desktop** (easiest): https://www.docker.com/products/docker-desktop/
- **Option B: Node 22 + Postgres 16**, if you'd rather not use Docker.

## Option A: Docker

```sh
git clone https://github.com/ngfamclam-cpu/Travel-planner.git
cd Travel-planner
git checkout claude/great-franklin-us4rfm
docker compose -f docker-compose.local.yml up --build
```

The first build takes a few minutes. When the log says `Worker up`, open **http://localhost:3000** and sign in with the password **`raverun`**.

**Fake prices for testing.** In a second terminal, in the same folder:

```sh
docker compose -f docker-compose.local.yml run --rm worker npm run demo
```

Everything it loads is labelled **DEMO**, and Home shows a red banner while it's loaded. To wipe it and start fresh:

```sh
docker compose -f docker-compose.local.yml run --rm worker npm run db:reset
```

**Stop:** press `Ctrl+C`. **Start again later:** run the same `up` command; your data is kept.

**On your phone:** while it runs, open `http://<your computer's local IP>:3000` on the same Wi-Fi. Find the IP in System Settings → Network on a Mac, or with `ipconfig` on Windows.

## Option B: Node + Postgres

```sh
git clone https://github.com/ngfamclam-cpu/Travel-planner.git && cd Travel-planner
git checkout claude/great-franklin-us4rfm
npm install
# point at your Postgres (create the database first: createdb raverun)
echo 'DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/raverun"' > packages/db/.env
export DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/raverun"
npm run db:deploy && npm run db:seed
npm run demo        # optional: fake DEMO prices
npm run dev         # http://localhost:3000 (no password in dev mode)
```

## Real prices

Copy `.env.example` to `.env` and fill in `SERPAPI_KEY`, plus `TICKETMASTER_API_KEY` and `SEATGEEK_CLIENT_ID` if you have them (see `docs/API_KEYS.md`). Then restart the app and run one check now:

```sh
docker compose -f docker-compose.local.yml run --rm worker npm run worker:once   # Docker
npm run worker:once                                                               # Node
```

Clear any demo data first (`db:reset`) so fake and real prices don't mix.

## What to try

1. **Home:** the grand total, today's alerts (with demo data: a 🎯 target alert and a ⚖️ CrowdVolt alert), the setup checklist.
2. **Ultra Miami trip → Dates row:** swipe the cards and switch the 🏨 chips (Cheapest / Best value / Best rated / My hotel / Rental). Tap **Use these dates** on a cheaper card, and watch the trip dates and line items change.
3. **Trip line items:** open **Edit** on the hotel. Change the search area, pin a hotel (📌), turn on rentals, enter a booking to get rebook alerts.
4. **Tickets tab:** **NYC club NYE** shows every platform. CrowdVolt shows ask and bid, StubHub shows "blocked", and Radiate is flagged red and not counted. Try **Log a price you saw** and **Target price**.
5. **Compare:** NYE options side by side. **Choose this one** makes it planned.
6. **Discover:** add your own event (it creates a trip: arrive the day before, leave the day after), or tap **Track tickets**.
7. **Settings:** airports and positioning costs, hotel floors, card questions, ticket fee %.

Anything odd? Screenshot it and tell me what you expected.
