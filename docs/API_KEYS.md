# Getting your API keys

Every key is optional. Without one, that data source is skipped and the app says "couldn't check …" instead of guessing. Put keys in `.env` on the server (copy `.env.example`), then restart: `docker compose up -d`.

Prices, quotas and signup flows change, so check each provider's page as you sign up. The numbers below were current when this was written.

| Order | Key | What it unlocks | Cost |
|---|---|---|---|
| — | *(none)* | **Flight prices: free, no key.** The flights-free sidecar reads Google Flights directly | $0 |
| **1 — recommended** | `SERPAPI_KEY` | Hotel prices, plus a flight backup if Google blocks the free source | Free tier, no card |
| 2 | `ANTHROPIC_API_KEY` | Daily brief prose + arrival guides (step 8–9) | Pay as you go, cents/day |
| 3 | `RESEND_API_KEY` | Daily brief by email (step 8) | Free tier |
| 4 | VAPID keys | Push notifications on your phone (step 8) | Free, no signup |
| 5 | `TICKETMASTER_API_KEY` | Ticket tracker: face value + on-sale status | Free |
| 6 | `EDMTRAIN_API_KEY` | EDM festival calendar (step 5) | Free, on request |
| 7 | `SEATGEEK_CLIENT_ID` | Ticket tracker: SeatGeek lowest price | Free, if approved |
| 8 | `GOOGLE_PLACES_API_KEY` | Better place data (ratings) for arrival guides; without it, guides use OpenStreetMap for free | Free monthly credit, card required |

---

> **No key needed** for StubHub, Vivid Seats, CrowdVolt, DICE and Resident Advisor: the tracker reads their public event pages once a day. With `SERPAPI_KEY` set, it also finds each event's page for you, using at most 4 searches per day and only once per event and platform. Radiate has no web prices, so you log those by hand.

## 1. SerpApi (hotels + flight backup)

Flights work without this key. SerpApi gives you real hotel prices, finds ticket-site event pages for you, and takes over flights for the day if Google blocks the free source.

1. Go to **https://serpapi.com/users/sign_up** and create an account (email + phone verification).
2. Pick the **Free** plan. SerpApi's own pages list it as 250 searches/month in one place and 100 in another. Check what your dashboard shows.
3. Copy your key from **https://serpapi.com/manage-api-key**.
4. In `.env`: `SERPAPI_KEY=your_key_here`
5. In the app: **Settings → SerpApi searches / month**: enter the number your dashboard shows. The worker spreads that across the month: 60% for flights, 40% for hotels.
6. Test it on the server: `docker compose exec worker npm run worker:once`, then open **Keys** in the app. You should see a successful flight run and a successful hotel run.

**Date cards need the paid plan:** every date card gets its own real hotel search. On the free tier, cards fill in slowly over days, with the chosen dates first. On the $25 plan most cards refresh daily.

**How far the free tier goes:** each search covers all 6 Boston-area airports and every destination airport at once. With ~10 trips that need flights, the free tier refreshes each trip's base dates every few days, plus some ±1–2 day variants. The **$25/month** plan (1,000 searches) covers daily checks with variants. The savings meter (step 10) will tell you if it's worth it.

**If flight runs fail with an airport error:** set `SERPAPI_COMBINE_AIRPORTS=0`. The app then searches each airport pair separately, which is reliable but uses more quota (so you may want to untick NYC airports in Settings).

## 2. Anthropic (Claude API)

1. **https://console.anthropic.com** → sign up → **Billing**: add a small amount of credit ($5 lasts a long time for one daily brief).
2. **API Keys** → **Create Key** → `ANTHROPIC_API_KEY=sk-ant-…`
3. Optional: set a monthly spend limit under **Limits**.

Claude (Opus 5.5, low effort) only writes the brief's opening paragraph. Every number it uses is checked against the day's data, and if it uses one that isn't there, the brief uses a plain summary instead. The rest of the brief is built straight from the database. Without a key you still get the full brief, just with the plain summary. Expect a few cents a day.

## 3. Resend (email)

1. **https://resend.com/signup** (free tier: 3,000 emails/month, 100/day).
2. **API Keys** → **Create API Key** (permission: *Sending access*) → `RESEND_API_KEY=re_…`
3. Sending to yourself works straight away with `onboarding@resend.dev` as the sender. To send from your own domain, add it under **Domains** and add the DNS records it shows (in DigitalOcean: **Networking → Domains**).
4. `BRIEF_EMAIL_TO=you@example.com`

## 4. VAPID keys (web push): no signup

Run once, with the app running:

```sh
docker compose exec worker npx web-push generate-vapid-keys
# (local Windows setup: docker compose -f docker-compose.local.yml exec worker npx web-push generate-vapid-keys)
```

Put the two values in `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, restart, then open **Settings → Daily brief → Turn on notifications on this device** on each phone or computer. Notifications need the app's **https** address: on the droplet that's automatic, and at home you can use `tailscale serve` for an https address on your tailnet. On Android, open the app in Chrome → menu → **Install app**, then allow notifications when asked.

## 5. Ticketmaster Discovery API

1. **https://developer-acct.ticketmaster.com/user/register**: create a developer account.
2. **My Apps** → your default app → copy the **Consumer Key** → `TICKETMASTER_API_KEY=…`
3. Free quota is about 5,000 calls/day, which is far more than the app needs.

## 6. Edmtrain

1. Request a key at **https://edmtrain.com/developer** (short form: say it's a personal, non-commercial trip planner).
2. They email the key → `EDMTRAIN_API_KEY=…`
3. Read their terms when the key arrives: they may require attribution (a link back to Edmtrain) wherever their data is shown. The Discover page will follow it.

## 7. SeatGeek

1. **https://seatgeek.com/account/develop** → **Create an app** → copy the **Client ID** → `SEATGEEK_CLIENT_ID=…`
2. SeatGeek has restricted new API access at times. If you can't get a key, skip it. Resale floors will then come from Ticketmaster and manual entry.

## 8. Google Places (optional: arrival guides)

Arrival guides already work without this: they use OpenStreetMap, which is free and needs no key. Google adds ratings and better coverage.

1. **https://console.cloud.google.com** → create a project → enable **Places API (New)**.
2. A billing account (card) is required, but Google gives a monthly free credit that one person's usage won't exceed.
3. **APIs & Services → Credentials → Create credentials → API key**. Restrict it to *Places API (New)* and to your droplet's IP.
4. `GOOGLE_PLACES_API_KEY=…`


---

### Keeping keys safe

- `.env` is in `.gitignore`. Never commit it.
- The **Keys** page only shows whether each key is set, never its value.
- If a key leaks, revoke it on the provider's site and paste a new one.
