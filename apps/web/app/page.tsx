import Link from "next/link";
import { setupChecklist } from "@rave-run/core";
import { prisma } from "@rave-run/db";
import { AlertList } from "@/components/AlertList";
import { getSettings, listTrips, openAlerts, providerHealth, type TripView } from "@/lib/data";
import { fmtRange, usd } from "@/lib/format";
import { keyStatus } from "@/lib/keys";

export const dynamic = "force-dynamic";

function TripBar({ t, max }: { t: TripView; max: number }) {
  const pct = (n: number) => `${max > 0 ? (n / max) * 100 : 0}%`;
  return (
    <Link href={`/trips/${t.id}`} className="card stripe" style={{ display: "block", color: "inherit", ["--stripe" as string]: t.color }}>
      <div className="spread">
        <strong>{t.name}</strong>
        <span className="big num" style={{ fontSize: "1.25rem" }}>{usd(t.totals.total)}</span>
      </div>
      <div className="spread" style={{ marginBottom: 8 }}>
        <small>{fmtRange(t.arrive, t.depart)} · {t.nights} nights</small>
        <span className="row">
          <span className={`chip ${t.status === "booked" ? "good" : t.status === "planned" ? "accent" : ""}`}>{t.status}</span>
          {t.totals.unpricedCount > 0 && <span className="chip">{t.totals.unpricedCount} not priced</span>}
          {t.clashes.length > 0 && <span className="chip bad">clash</span>}
        </span>
      </div>
      <div className="bar" title="booked / quoted / estimated">
        <span style={{ width: pct(t.totals.booked), background: "var(--good)" }} />
        <span style={{ width: pct(t.totals.quoted), background: "var(--info)" }} />
        <span style={{ width: pct(t.totals.estimated), background: "var(--warn)", opacity: 0.7 }} />
      </div>
    </Link>
  );
}

export default async function Home() {
  const [trips, settings, health, pointsSetting, alerts, demo] = await Promise.all([
    listTrips(),
    getSettings(),
    providerHealth(),
    prisma.setting.findUnique({ where: { key: "pointsUpdatedAt" } }),
    openAlerts(),
    prisma.setting.findUnique({ where: { key: "demoDataLoadedAt" } }),
  ]);
  const active = trips.filter((t) => t.status !== "done");
  const committed = active.filter((t) => t.status === "planned" || t.status === "booked");
  const considering = active.filter((t) => t.status === "considering");
  const grand = committed.reduce((s, t) => s + t.totals.total, 0);
  const max = Math.max(1, ...active.map((t) => t.totals.total));
  const checklist = setupChecklist(settings, { pointsUpdated: !!pointsSetting, keys: keyStatus() });
  const open = checklist.filter((c) => !c.done);

  // Action items available in step 3. Buy/wait signals arrive with the signal engine (step 6).
  const actions: { text: string; href: string; tone: "warn" | "bad" }[] = [];
  for (const h of health.filter((h) => !h.ok)) {
    actions.push({ text: `Couldn't check ${h.kind} prices: ${h.error?.split("\n")[0]}`, href: "/setup", tone: "bad" });
  }
  for (const kind of ["flight", "hotel"]) {
    if (!health.some((h) => h.kind === kind)) {
      actions.push({ text: `${kind === "flight" ? "Flight" : "Hotel"} prices haven't been checked in the last 48h.`, href: "/setup", tone: "warn" });
    }
  }
  for (const t of committed) {
    for (const c of t.clashes) actions.push({ text: `${t.name}: ${c.message}`, href: `/trips/${t.id}`, tone: c.kind === "overlap" ? "bad" : "warn" });
    const stale = t.items.filter((i) => i.quoteStale && i.bookedAmount == null);
    if (stale.length) actions.push({ text: `${t.name}: ${stale.length} quote${stale.length > 1 ? "s" : ""} older than 48h`, href: `/trips/${t.id}`, tone: "warn" });
  }

  const slots = [...new Set(considering.map((t) => t.slot ?? "Other ideas"))];

  return (
    <>
      {demo && (
        <div className="alert bad">
          <strong>Demo data loaded:</strong> prices labelled DEMO are fake, for trying the app. Clear them with <code>npm run db:reset</code> (Docker:{" "}
          <code>docker compose -f docker-compose.local.yml run --rm worker npm run db:reset</code>).
        </div>
      )}
      <section className="card">
        <small>Planned + booked trips</small>
        <div className="big num">{usd(grand)}</div>
        <small>
          {committed.length} trip{committed.length === 1 ? "" : "s"} · {considering.length} options being considered (not in the total)
        </small>
        <div className="row" style={{ marginTop: 8 }}>
          <span className="chip good">booked</span>
          <span className="chip info">quoted</span>
          <span className="chip warn">estimate</span>
        </div>
      </section>

      <h2>Today</h2>
      <AlertList alerts={alerts} />
      {actions.length === 0 && alerts.length === 0 && <p className="muted">Nothing needs action.</p>}
      {actions.map((a, i) => (
        <Link key={i} href={a.href} className={`alert ${a.tone}`} style={{ display: "block", color: "inherit" }}>{a.text}</Link>
      ))}

      {open.length > 0 && (
        <details className="card">
          <summary><strong>Setup checklist</strong> · {open.length} open question{open.length > 1 ? "s" : ""}</summary>
          <ul>
            {checklist.map((c) => (
              <li key={c.id} style={{ opacity: c.done ? 0.5 : 1 }}>
                {c.done ? "✓ " : ""}<Link href={c.href}>{c.question}</Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      <h2>Trips</h2>
      {committed.map((t) => <TripBar key={t.id} t={t} max={max} />)}
      {committed.length === 0 && <p className="muted">No planned trips yet. Pick options in <Link href="/compare">Compare</Link>.</p>}

      {slots.map((slot) => (
        <section key={slot}>
          <h2>
            {slot} <small>· considering</small>
          </h2>
          {considering.filter((t) => (t.slot ?? "Other ideas") === slot).map((t) => <TripBar key={t.id} t={t} max={max} />)}
        </section>
      ))}
    </>
  );
}
