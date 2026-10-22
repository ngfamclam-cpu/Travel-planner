// Rave Run worker: scheduled scrapes and price snapshots. All schedules in America/New_York (spec §4).
import cron from "node-cron";
import { prisma } from "@rave-run/db";
import { findEventPage, flightProviders, hotelProvider, ticketCheckers } from "@rave-run/providers";
import { pgQueryCache } from "./cache";
import { runFlightJob } from "./jobs/flights";
import { runHotelJob } from "./jobs/hotels";
import { runTicketJob } from "./jobs/tickets";
import { runPrune } from "./jobs/prune";

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

async function main() {
  if (process.argv.includes("--once")) {
    await flights();
    await hotels();
    await tickets();
    await prisma.$disconnect();
    return;
  }
  console.log(`Worker up. Flights: "${FLIGHT_SCHEDULE}", hotels: "${HOTEL_SCHEDULE}", tickets: "${TICKET_SCHEDULE}" ${TZ}`);
  cron.schedule(FLIGHT_SCHEDULE, flights, { timezone: TZ });
  cron.schedule(HOTEL_SCHEDULE, hotels, { timezone: TZ });
  cron.schedule(TICKET_SCHEDULE, tickets, { timezone: TZ });
  cron.schedule("30 3 * * *", prune, { timezone: TZ });
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
