// Rave Run worker: scheduled scrapes and price snapshots. All schedules in America/New_York (spec §4).
import cron from "node-cron";
import { prisma } from "@rave-run/db";
import { fetchEdmtrainFestivals, fetchTicketmasterFestivals, findEventPage, flightProviders, hotelProvider, ticketCheckers } from "@rave-run/providers";
import { pgQueryCache } from "./cache";
import { runFlightJob } from "./jobs/flights";
import { runHotelJob } from "./jobs/hotels";
import { runTicketJob } from "./jobs/tickets";
import { runPrune } from "./jobs/prune";
import { runDiscovery } from "./jobs/discovery";
import { JobRunner, settingsLastRunStore } from "./scheduler";

const TZ = "America/New_York";
// Flights run early so the 7:00 brief (step 8) has fresh numbers; searches are paced inside the job.
const FLIGHT_SCHEDULE = process.env.FLIGHT_CRON ?? "10 5 * * *";
const HOTEL_SCHEDULE = process.env.HOTEL_CRON ?? "40 5 * * *";
const TICKET_SCHEDULE = process.env.TICKET_CRON ?? "20 6 * * *";
const PAUSE_MS = Number(process.env.WORKER_PAUSE_MS ?? 20_000);

async function flights() {
  const { primary, fallback } = flightProviders(process.env, pgQueryCache(prisma));
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

async function main() {
  const runner = new JobRunner(
    [
      { name: "flights", run: flights },
      { name: "hotels", run: hotels },
      { name: "tickets", run: tickets },
      { name: "discovery", run: discovery, catchUpHours: 24 * 7 },
      { name: "prune", run: prune },
    ],
    settingsLastRunStore(prisma),
  );
  if (process.argv.includes("--once")) {
    await runner.runAll();
    await prisma.$disconnect();
    return;
  }
  console.log(`Worker up. Flights: "${FLIGHT_SCHEDULE}", hotels: "${HOTEL_SCHEDULE}", tickets: "${TICKET_SCHEDULE}" ${TZ}`);
  cron.schedule(FLIGHT_SCHEDULE, () => runner.scheduled("flights"), { timezone: TZ });
  cron.schedule(HOTEL_SCHEDULE, () => runner.scheduled("hotels"), { timezone: TZ });
  cron.schedule(TICKET_SCHEDULE, () => runner.scheduled("tickets"), { timezone: TZ });
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
