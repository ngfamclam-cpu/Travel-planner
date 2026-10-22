// Rave Run worker: scheduled scrapes and price snapshots. All schedules in America/New_York (spec §4).
import cron from "node-cron";
import { prisma } from "@rave-run/db";
import { flightProvider, hotelProvider } from "@rave-run/providers";
import { pgQueryCache } from "./cache";
import { runFlightJob } from "./jobs/flights";
import { runHotelJob } from "./jobs/hotels";

const TZ = "America/New_York";
// Flights run early so the 7:00 brief (step 8) has fresh numbers; searches are paced inside the job.
const FLIGHT_SCHEDULE = process.env.FLIGHT_CRON ?? "10 5 * * *";
const HOTEL_SCHEDULE = process.env.HOTEL_CRON ?? "40 5 * * *";
const PAUSE_MS = Number(process.env.WORKER_PAUSE_MS ?? 20_000);

async function flights() {
  const provider = flightProvider(process.env, pgQueryCache(prisma));
  try {
    await runFlightJob(prisma, provider, { pauseMs: PAUSE_MS });
  } catch (e) {
    console.error("Flight job crashed:", e);
    await prisma.providerRun.create({
      data: { provider: provider.info.name, kind: "flight", ok: false, error: `crash: ${(e as Error).message}` },
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

async function main() {
  if (process.argv.includes("--once")) {
    await flights();
    await hotels();
    await prisma.$disconnect();
    return;
  }
  console.log(`Worker up. Flights: "${FLIGHT_SCHEDULE}", hotels: "${HOTEL_SCHEDULE}" ${TZ}`);
  cron.schedule(FLIGHT_SCHEDULE, flights, { timezone: TZ });
  cron.schedule(HOTEL_SCHEDULE, hotels, { timezone: TZ });
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
