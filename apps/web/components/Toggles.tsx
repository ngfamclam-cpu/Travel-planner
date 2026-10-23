import { setTripPlanned, toggleLineItemIncluded } from "@/app/actions";

/** On/off switch for one expense: off = shown, but left out of every total. */
export function IncludeSwitch({ id, included }: { id: string; included: boolean }) {
  return (
    <form action={toggleLineItemIncluded} className="switch-row">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className={`switch ${included ? "on" : ""}`}
        role="switch"
        aria-checked={included}
        title={included ? "Counted in the total. Click to leave it out." : "Left out of the total. Click to count it."}
      >
        <span className="track" />
        {included ? "In total" : "Not counted"}
      </button>
    </form>
  );
}

/** Plan / unplan a trip. Booked and finished trips are changed in Trip details instead. */
export function PlanButton({ id, status, compact = false }: { id: string; status: string; compact?: boolean }) {
  if (status !== "planned" && status !== "considering") return null;
  const planned = status === "planned";
  return (
    <form action={setTripPlanned}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="planned" value={planned ? "0" : "1"} />
      <button
        type="submit"
        className={`switch ${planned ? "on" : ""}`}
        role="switch"
        aria-checked={planned}
        title={planned ? "Planned: counted in your total. Click to unplan." : "Not planned. Click to plan this trip."}
      >
        <span className="track" />
        {compact ? (planned ? "Planned" : "Plan") : planned ? "Planned (counts in your total)" : "Not planned"}
      </button>
    </form>
  );
}
