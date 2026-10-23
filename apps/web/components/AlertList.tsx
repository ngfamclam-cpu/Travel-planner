import { dismissAlert } from "@/app/actions";
import { fmtWhen } from "@/lib/format";

export interface AlertRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  createdAt: Date;
}

const ICON: Record<string, string> = {
  rebook: "🔁",
  buy_now: "🟢",
  ticket_target: "🎯",
  ticket_drop: "📉",
  ticket_onsale: "🎟",
  ticket_soldout: "⛔",
  crowdvolt_gap: "⚖️",
};

export function AlertList({ alerts }: { alerts: AlertRow[] }) {
  return (
    <>
      {alerts.map((a) => (
        <div key={a.id} className="alert good">
          <div className="spread">
            <strong>{ICON[a.kind] ?? "🔔"} {a.title}</strong>
            <form action={dismissAlert}>
              <input type="hidden" name="id" value={a.id} />
              <button type="submit" className="ghost" style={{ padding: "2px 8px", fontSize: 12 }}>Dismiss</button>
            </form>
          </div>
          <div>{a.body}</div>
          <small>
            {a.url && <><a href={a.url} target="_blank" rel="noreferrer">Open it ↗</a> · </>}found {fmtWhen(a.createdAt)}
          </small>
        </div>
      ))}
    </>
  );
}
