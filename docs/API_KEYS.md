# Getting your API keys

Every key is optional. Without one, that data source is skipped and the app says "couldn't check …" instead of guessing. Put keys in `.env` on the server (copy `.env.example`), then restart: `docker compose up -d`.

Prices, quotas and signup flows change, so check each provider's page as you sign up. The numbers below were current when this was written.

| Order | Key | What it unlocks | Cost |
|---|---|---|---|
| **1 — do now** | `SERPAPI_KEY` | Real Google Flights prices for your event dates (and hotels in step 4) | Free tier |
| 2 | `ANTHROPIC_API_KEY` | Daily brief prose + arrival guides (step 8–9) | Pay as you go, cents/day |
| 3 | `RESEND_API_KEY` | Daily brief by email (step 8) | Free tier |
| 4 | VAPID keys | Push notifications on your phone (step 8) | Free, no signup |
| 5 | `TICKETMASTER_API_KEY` | Ticket tracker: face value + on-sale status | Free |
| 6 | `EDMTRAIN_API_KEY` | EDM festival calendar (step 5) | Free, on request |
| 7 | `SEATGEEK_CLIENT_ID` | Ticket tracker: SeatGeek lowest price | Free, if approved |
| 8 | `GOOGLE_PLACES_API_KEY` | Real restaurant/place names in arrival guides (step 9) | Free monthly credit, card required |

---

> **No key needed** for StubHub, Vivid Seats, CrowdVolt, DICE and Resident Advisor: the tracker reads their public event pages once a day. With `SERPAPI_KEY` set, it also finds each event's page for you, using at most 4 searches per day and only once per event and platform. Radiate has no web prices, so you log those by hand.

## 1. SerpApi (Google Flights + Google Hotels): do this one first

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

Claude only writes the words. Every number in the brief comes from the database.

## 3. Resend (email)

1. **https://resend.com/signup** (free tier: 3,000 emails/month, 100/day).
2. **API Keys** → **Create API Key** (permission: *Sending access*) → `RESEND_API_KEY=re_…`
3. Sending to yourself works straight away with `onboarding@resend.dev` as the sender. To send from your own domain, add it under **Domains** and add the DNS records it shows (in DigitalOcean: **Networking → Domains**).
4. `BRIEF_EMAIL_TO=you@example.com`

## 4. VAPID keys (web push): no signup

Run once, anywhere with Node:

```sh
npx web-push generate-vapid-keys
```

Put the two values in `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. On Android, open the app in Chrome → menu → **Install app**, then allow notifications when asked.

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

## 8. Google Places (arrival guides)

1. **https://console.cloud.google.com** → create a project → enable **Places API (New)**.
2. A billing account (card) is required, but Google gives a monthly free credit that one person's usage won't exceed.
3. **APIs & Services → Credentials → Create credentials → API key**. Restrict it to *Places API (New)* and to your droplet's IP.
4. `GOOGLE_PLACES_API_KEY=…`

An alternative with no card is the Foursquare Places free tier; tell me if you'd rather use that.

---

### Keeping keys safe

- `.env` is in `.gitignore`. Never commit it.
- The **Keys** page only shows whether each key is set, never its value.
- If a key leaks, revoke it on the provider's site and paste a new one.
