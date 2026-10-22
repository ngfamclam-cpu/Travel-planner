# Deploy to your DigitalOcean droplet

## What you need

| | Needed? | Notes |
|---|---|---|
| Your droplet | ✅ | Ubuntu or Debian. 1 GB RAM is enough to run it; the setup script adds swap so the build fits. |
| SSH access as root (or sudo) | ✅ | `ssh root@your-droplet-ip` |
| A domain | Optional | Without one, the app uses a free `your-ip.sslip.io` address with real HTTPS. |
| `SERPAPI_KEY` | For hotel prices (flights are free without it) | Free tier, no card: 250 searches/month (some SerpApi pages say 100). $25/mo for 1,000. See `docs/API_KEYS.md`. |
| `TICKETMASTER_API_KEY`, `SEATGEEK_CLIENT_ID` | Optional | Free. Other ticket sites need no key. |

## Steps (about 20 minutes, most of it the first build)

```sh
ssh root@YOUR_DROPLET_IP
git clone https://github.com/ngfamclam-cpu/Travel-planner.git rave-run
cd rave-run && git checkout claude/great-franklin-us4rfm
sudo bash scripts/setup-droplet.sh --check    # optional: report only, changes nothing
sudo bash scripts/setup-droplet.sh
```

If the repo is private, `git clone` asks for a login. Use your GitHub username and a personal access token (GitHub → Settings → Developer settings → Fine-grained tokens, with read access to this repo) as the password.

The script:
1. Checks RAM, disk and CPU, and offers to add a 2 GB swap file on small droplets.
2. Installs Docker if it's missing (asks first).
3. Checks ports 80/443. If they're free, Caddy serves HTTPS automatically. If another web server already uses them, the app stays on `127.0.0.1:3000` and the script prints the nginx lines to add.
4. Creates `.env` with generated secrets, and asks for your app password, address and SerpApi key.
5. Builds, starts, waits until the app answers, and prints the URL and password.

**Updating later:** `sudo bash scripts/update.sh`

## Will it eat up my usage?

**DigitalOcean bill:** no. A droplet costs a fixed monthly price whatever runs on it, and the app stays well inside a small one:

| | Rave Run uses | Typical small droplet |
|---|---|---|
| RAM | ~500–700 MB running (Postgres, web, worker, Caddy) | 1–2 GB (+2 GB swap from the script) |
| Disk | ~3–4 GB of images + under 1 GB of data per year (old raw search results are trimmed nightly; logs are capped) | 25–50 GB |
| Bandwidth | well under 1 GB/month (one user, small API responses) | 500 GB–1 TB included |
| CPU | busy for a few minutes around 5–6 AM ET, idle otherwise | 1 vCPU is fine |

Check your plan's numbers on the droplet's page. The only thing that can cost extra is resizing the droplet, and you'd have to do that yourself.

If the droplet already runs other sites, the app adds roughly 600 MB of RAM. Run `--check` first and look at `free -m`. If RAM + swap is tight, the script's swap file covers it.

**Free flight source:** no account, no quota, no bill. The only limit is the daily request cap you set, which keeps Google from noticing.

**SerpApi:** this is the real usage limit. The app spreads your monthly allowance over the month: 60% flights, 40% hotels, and at most 4 searches a day to find ticket pages. It never goes over the number you set in **Settings → SerpApi searches / month**. On the free tier, date cards fill in over several days. On the $25 plan they refresh most days.

**Other APIs:** Ticketmaster and SeatGeek are free and the app stays far under their limits.

## Will it work?

- **Flights (free source):** most likely, but not guaranteed. It reads Google Flights the way a browser does, from your droplet's IP. Google sometimes blocks or rate-limits cloud servers. If it does, the Keys page shows `google_flights_free` failing, and the worker switches to SerpApi for that run if you have a key. Lowering **Settings → Free flight source: requests / day** helps.
- **Hotels, Ticketmaster, SeatGeek:** yes, once the keys are in `.env`. These are official APIs.
- **StubHub, Vivid Seats, CrowdVolt, DICE, RA page checks:** partly. These sites often block requests from cloud servers (DigitalOcean IPs are well known), so expect some rows to say "blocked: check manually". The one-tap links and the log-a-price form always work. DICE and RA are the most likely to work; Vivid Seats and StubHub the least.
- **Radiate:** manual by design.

## First real run

After the setup script finishes (flights need nothing; hotels need `SERPAPI_KEY`):

```sh
docker compose exec worker npm run worker:once
```

Then open **Keys** in the app to see what each source returned, and a trip page to see the first real date cards.

## Handy commands

```sh
docker compose ps                          # what's running
docker compose logs -f worker              # watch the daily jobs
docker compose exec worker npm run worker:once   # run all checks now
docker compose exec worker npm run demo    # fake DEMO prices (clear with: docker compose exec worker npm run db:reset)
nano .env && docker compose up -d          # change keys/passwords, then restart
```

Backups: `docker compose exec postgres pg_dump -U raverun raverun > raverun-$(date +%F).sql`
