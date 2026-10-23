import Link from "next/link";
import { TicketTracker } from "@/components/TicketTracker";
import { platformIcons, trackedEvents } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Tickets() {
  const [events, icons] = await Promise.all([trackedEvents(), platformIcons()]);
  return (
    <>
      <h1>Tickets</h1>
      <p className="muted">
        Prices across Ticketmaster, SeatGeek, StubHub, Vivid Seats, DICE, Resident Advisor and, for NYC, CrowdVolt. Radiate prices you log are shown but never counted.
        Events are tracked automatically when they have a trip; track others from <Link href="/events">Discover</Link>.
      </p>
      {events.length === 0 && <p className="muted">Nothing tracked yet. The worker sets up tracking on its next run (6:20 AM ET), or open a trip.</p>}
      {events.map((t) => <TicketTracker key={t.eventId} t={t} showEventName icons={icons} />)}
    </>
  );
}
