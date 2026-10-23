// Rave Run worker: scheduled scrapes and price snapshots. All schedules in America/New_York (spec §4).
import cron from "node-cron";
import { prisma } from "@rave-run/db";
import { fetchEdmtrainFestivals, fetchImage, fetchTicketmasterFestivals, findEventPage, flightProvider, flightProviders, geocode, googlePlaces, hotelProvider, osmPlaces, pageImageUrls, ticketCheckers } from "@rave-run/providers";
import { mergeSettings } from "@rave-run/core";
import { pgQueryCache } from "./cache";
import { runFlightJob } from "./jobs/flights";
import { runHotelJob } from "./jobs/hotels";
import { runTicketJob } from "./jobs/tickets";
import { runPrune } from "./jobs/prune";
import { runDiscovery } from "./jobs/discovery";
import { runSignals } from "./jobs/signals";
import { briefIfDue, runBrief, type BriefDeps } from "./jobs/brief";
import { writeSummary } from "./brief/summary";
import { runGuides, type GuideDeps } from "./jobs/guides";
import { runSavingsCheck } from "./jobs/savings";
import { runImages, type ImageDeps } from "./jobs/images";
import { claudeGuideWriter } from "./guides/claude";
import { JobRunner, settingsLastRunStore } from "./scheduler";

const TZ = "America/New_York";
// Flights run early so the 7:00 brief (step 8) has fresh numbers; searches are paced inside the job.
const FLIGHT_SCHEDULE = process.env.FLIGHT_CRON ?? "10 5 * * *";
const HOTEL_SCHEDULE = process.env.HOTEL_CRON ?? "40 5 * * *";
const TICKET_SCHEDULE = process.env.TICKET_CRON ?? "20 6 * * *";
const PAUSE_MS = Number(process.env.WORKER_PAUSE_MS ?? 20_000);

async function flights() {
  // Settings → Data tier: "paid" puts SerpApi first; FLIGHT_SOURCE in .env overrides either way.
  const tier = mergeSettings(await prisma.setting.findMany()).dataTier;
  const source = process.env.FLIGHT_SOURCE && process.env.FLIGHT_SOURCE !== "auto" ? process.env.FLIGHT_SOURCE : tier === "paid" ? "paid" : "auto";
  const { primary, fallback } = flightProviders({ ...process.env, FLIGHT_SOURCE: source }, pgQueryCache(prisma));
  try {
    await runFlightJob(prisma, primary, { pauseMs: primary.info.costPerPair ? 0 : PAUSE_MS, fallback });
  } catch (e) {
    console.error("Flight job crashed:", e);
    await prisma.providerRun.create({
      data: { provider: primary.info.name, kind: "flight", ok: false, error: `crash: ${(e as Error).message}` },
    });
  }
}

async function hotels() {
  const provider = hotelProvider(process.env, pgQueryCache(prisma));
  try {
    await runHotelJob(prisma, provider, { pauseMs: PAUSE_MS });
  } catch (e) {
    console.error("Hotel job crashed:", e);
    await prisma.providerRun.create({
      data: { provider: provider.info.name, kind: "hotel", ok: false, error: `crash: ${(e as Error).message}` },
    });
  }
}

async function tickets() {
  try {
    const key = process.env.SERPAPI_KEY;
    await runTicketJob(prisma, ticketCheckers(process.env), {
      pauseMs: PAUSE_MS,
      findPage: key ? (e, domain) => findEventPage(e, domain, key) : undefined,
    });
  } catch (e) {
    console.error("Ticket job crashed:", e);
    await prisma.providerRun.create({ data: { provider: "tickets", kind: "ticket", ok: false, error: `crash: ${(e as Error).message}` } });
  }
}

async function savings() {
  try {
    await runSavingsCheck(prisma, flightProvider(process.env, pgQueryCache(prisma)));
  } catch (e) {
    console.error("Savings check crashed:", e);
  }
}

async function prune() {
  try {
    console.log("Prune:", await runPrune(prisma));
  } catch (e) {
    console.error("Prune crashed:", e);
  }
}

async function discovery() {
  const env = process.env;
  try {
    await runDiscovery(prisma, [
      {
        name: "edmtrain",
        configured: !!env.EDMTRAIN_API_KEY,
        envKey: "EDMTRAIN_API_KEY",
        fetch: (r) => fetchEdmtrainFestivals(env.EDMTRAIN_API_KEY!, r, { locationIds: env.EDMTRAIN_LOCATION_IDS }),
      },
      {
        name: "ticketmaster",
        configured: !!env.TICKETMASTER_API_KEY,
        envKey: "TICKETMASTER_API_KEY",
        fetch: (r) => fetchTicketmasterFestivals(env.TICKETMASTER_API_KEY!, r),
      },
    ]);
  } catch (e) {
    console.error("Discovery crashed:", e);
  }
}

async function signals() {
  try {
    await runSignals(prisma);
  } catch (e) {
    console.error("Signals crashed:", e);
  }
}

function briefDeps(): BriefDeps {
  const env = process.env;
  return {
    summarize: (p) => writeSummary(p, { apiKey: env.ANTHROPIC_API_KEY, model: env.BRIEF_MODEL }),
    email: { apiKey: env.RESEND_API_KEY, to: env.BRIEF_EMAIL_TO, from: env.BRIEF_EMAIL_FROM },
    push: { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.BRIEF_EMAIL_TO ? `mailto:${env.BRIEF_EMAIL_TO}` : undefined },
    baseUrl: env.APP_URL ?? (env.DOMAIN ? `https://${env.DOMAIN}` : ""),
  };
}

function guideDeps(): GuideDeps {
  const env = process.env;
  const gKey = env.GOOGLE_PLACES_API_KEY;
  return {
    geocode: (q) => geocode(q),
    places: gKey ? (lat, lng) => googlePlaces(gKey, lat, lng) : (lat, lng) => osmPlaces(lat, lng),
    placesSource: gKey ? "Google Places" : "OpenStreetMap",
    writer: claudeGuideWriter({ apiKey: env.ANTHROPIC_API_KEY, model: env.BRIEF_MODEL }),
    pauseMs: 2000, // OpenStreetMap's usage policy: go easy
  };
}

async function guides() {
  try {
    await runGuides(prisma, guideDeps());
  } catch (e) {
    console.error("Guides crashed:", e);
  }
}

let guideRequestsRunning = false;
async function guideRequests() {
  if (guideRequestsRunning) return;
  guideRequestsRunning = true;
  try {
    await runGuides(prisma, guideDeps(), { onlyRequested: true, log: () => {} });
  } catch (e) {
    console.error("Guide requests crashed:", e);
  } finally {
    guideRequestsRunning = false;
  }
}

const imageDeps: ImageDeps = {
  pageImageUrls: (u) => pageImageUrls(u),
  fetchImage: (u, maxBytes) => fetchImage(u, { maxBytes }),
  pauseMs: 1500,
};

async function images() {
  try {
    await runImages(prisma, imageDeps);
  } catch (e) {
    console.error("Images crashed:", e);
  }
}

let newImagesRunning = false;
async function newImages() {
  if (newImagesRunning) return;
  newImagesRunning = true;
  try {
    await runImages(prisma, imageDeps, { onlyNew: true, limit: 5, log: () => {} });
  } catch (e) {
    console.error("New images crashed:", e);
  } finally {
    newImagesRunning = false;
  }
}

let briefRunning = false;
async function brief() {
  if (briefRunning) return;
  briefRunning = true;
  try {
    await briefIfDue(prisma, briefDeps());
  } catch (e) {
    console.error("Brief crashed:", e);
  } finally {
    briefRunning = false;
  }
}

async function main() {
  const runner = new JobRunner(
    [
      { name: "flights", run: flights },
      { name: "savings", run: savings },
      { name: "hotels", run: hotels },
      { name: "tickets", run: tickets },
      // After the price jobs, so signals see today's prices.
      { name: "signals", run: signals },
      { name: "discovery", run: discovery, catchUpHours: 24 * 7 },
      { name: "guides", run: guides, catchUpHours: 24 * 7 },
      { name: "images", run: images, catchUpHours: 24 * 7 },
      { name: "prune", run: prune },
    ],
    settingsLastRunStore(prisma),
  );
  if (process.argv.includes("--brief")) {
    // Build (or rebuild) today's brief now and send it: npm run brief
    await runBrief(prisma, briefDeps(), { force: true });
    await prisma.$disconnect();
    return;
  }
  if (process.argv.includes("--once")) {
    await runner.runAll();
    await prisma.$disconnect();
    return;
  }
  console.log(`Worker up. Flights: "${FLIGHT_SCHEDULE}", hotels: "${HOTEL_SCHEDULE}", tickets: "${TICKET_SCHEDULE}" ${TZ}`);
  cron.schedule(FLIGHT_SCHEDULE, () => runner.scheduled("flights"), { timezone: TZ });
  cron.schedule(HOTEL_SCHEDULE, () => runner.scheduled("hotels"), { timezone: TZ });
  cron.schedule(TICKET_SCHEDULE, () => runner.scheduled("tickets"), { timezone: TZ });
  cron.schedule("50 6 * * *", () => runner.scheduled("signals"), { timezone: TZ });
  // Every 5 minutes: build today's brief once it's past your brief time (catches up after downtime).
  cron.schedule("*/5 * * * *", brief, { timezone: TZ });
  // Guides: weekly refresh (Sundays), plus "Build guide now" requests from the trip page every 5 minutes.
  cron.schedule("15 4 * * 0", () => runner.scheduled("guides"), { timezone: TZ });
  cron.schedule("*/5 * * * *", guideRequests, { timezone: TZ });
  // Images: weekly sweep (Saturdays), plus events that just got an official site, every 5 minutes.
  cron.schedule("20 4 * * 6", () => runner.scheduled("images"), { timezone: TZ });
  cron.schedule("*/5 * * * *", newImages, { timezone: TZ });
  cron.schedule("30 3 * * *", () => runner.scheduled("prune"), { timezone: TZ });
  cron.schedule("45 6 * * 1", () => runner.scheduled("discovery"), { timezone: TZ }); // Mondays
  // Missed runs (computer off or asleep): check on startup and every hour.
  const catchUp = (why: string) =>
    runner.catchUp(why).then((ran) => ran.length && console.log(`Caught up: ${ran.join(", ")}`), (e) => console.error("Catch-up failed:", e));
  setTimeout(() => catchUp("startup"), 30_000); // let the database and flights-free settle first
  cron.schedule("17 * * * *", () => catchUp("hourly check"), { timezone: TZ });
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
