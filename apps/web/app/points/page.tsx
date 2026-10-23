import Link from "next/link";
import { centsPerPoint, redeemVerdict } from "@rave-run/core";
import { prisma } from "@rave-run/db";
import { deleteRedemption, savePointValues, savePoints, saveRedemption } from "@/app/actions";
import { getPoints, getSettings, listTrips } from "@/lib/data";
import { usd } from "@/lib/format";

export const dynamic = "force-dynamic";

type Q = { cash?: string; taxes?: string; points?: string; item?: string; saved?: string };

export default async function Points({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const [settings, balances, partners, trips, saved] = await Promise.all([
    getSettings(),
    getPoints(),
    prisma.transferPartner.findMany({ orderBy: [{ currency: "asc" }, { partner: "asc" }] }),
    listTrips(),
    prisma.redemption.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { lineItem: { include: { trip: true } } } }),
  ]);
  const cash = Number(q.cash);
  const taxes = Number(q.taxes || 0);
  const points = Number((q.points ?? "").replace(/[,\s]/g, ""));
  const ready = cash > 0 && points > 0;
  const cpp = ready ? centsPerPoint(cash, taxes, points) : null;
  const verdict = cpp != null ? redeemVerdict(cpp, settings.cppFloor) : null;
  const items = trips
    .filter((t) => t.status !== "done")
    .flatMap((t) => t.items.filter((i) => i.kind === "flight" || i.kind === "hotel").map((i) => ({ id: i.id, label: `${t.name}: ${i.label}` })));

  return (
    <>
      <h1>Points</h1>
      {q.saved && <div className="alert good">Saved. It shows on the trip's line item.</div>}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Is this award worth it?</h2>
        <p className="muted">cents per point = (cash price − award taxes &amp; fees) ÷ points × 100. Your floor is {settings.cppFloor}¢: below it, pay cash and earn instead.</p>
        <form className="fields" method="get">
          {q.item && <input type="hidden" name="item" value={q.item} />}
          <div><label>Cash price ($)</label><input name="cash" inputMode="decimal" defaultValue={q.cash ?? ""} required /></div>
          <div><label>Points needed</label><input name="points" inputMode="numeric" defaultValue={q.points ?? ""} required /></div>
          <div><label>Award taxes &amp; fees ($)</label><input name="taxes" inputMode="decimal" defaultValue={q.taxes ?? ""} /></div>
          <div><label>&nbsp;</label><button type="submit">Calculate</button></div>
        </form>
        {cpp != null && verdict && (
          <div className={`alert ${verdict.verdict === "redeem" ? "good" : "warn"}`} style={{ marginTop: 10 }}>
            <div className="big num" style={{ fontSize: "1.6rem" }}>{cpp.toFixed(2)}¢ per point</div>
            <div>{verdict.text}</div>
            <form action={saveRedemption} className="row" style={{ marginTop: 8 }}>
              <input type="hidden" name="cash" value={cash} />
              <input type="hidden" name="taxes" value={taxes} />
              <input type="hidden" name="points" value={points} />
              <select name="lineItemId" defaultValue={q.item ?? ""} required style={{ flex: "1 1 220px" }}>
                <option value="" disabled>Save to a trip item…</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
              </select>
              <button type="submit" className="ghost">Save</button>
            </form>
          </div>
        )}
        <p className="muted" style={{ marginBottom: 0 }}>
          <small>Award search for Asia: check Amex MR → ANA, and Citi TYP's partners (EVA, Cathay, Singapore), first. Automatic award search arrives with the paid tier (step 10).</small>
        </p>
      </section>

      {saved.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Saved award options</h2>
          {saved.map((r) => (
            <div key={r.id} className="spread li">
              <div>
                <Link href={`/trips/${r.lineItem.tripId}`}>{r.lineItem.trip.name}</Link>: {r.lineItem.label}
                <div><small className="num">{r.points.toLocaleString()} pts + {usd(Number(r.taxesFees), true)} vs {usd(Number(r.cashPrice))} cash</small></div>
              </div>
              <div className="row">
                <span className={`chip ${r.verdict === "redeem" ? "good" : "warn"}`}>{Number(r.cpp).toFixed(2)}¢ · {r.verdict === "redeem" ? "use points" : "pay cash"}</span>
                <form action={deleteRedemption}><input type="hidden" name="id" value={r.id} /><button className="ghost" style={{ padding: "2px 8px", fontSize: 12 }}>✕</button></form>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Balances</h2>
        <p className="muted">Entered by hand: card issuers don't offer a balance API. Update monthly.</p>
        <form action={savePoints} className="fields">
          {balances.map((p) => (
            <div key={p.id}><label>{p.currency}</label><input name={`pts_${p.currency}`} inputMode="numeric" defaultValue={p.balance} /></div>
          ))}
          <div className="wide"><button type="submit">Save balances</button></div>
        </form>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>What your points are worth</h2>
        <p className="muted">Used to compare cards: 4x at 1.5¢ is 6% back. Transferable points are usually worth more than 1¢.</p>
        <form action={savePointValues} className="fields">
          {Object.entries(settings.pointValues).map(([k, v]) => (
            <div key={k}><label>{k} (¢/pt)</label><input name={`val_${k}`} inputMode="decimal" defaultValue={v} /></div>
          ))}
          <div className="wide"><button type="submit" className="ghost">Save values</button></div>
        </form>
      </section>

      <details className="card">
        <summary><strong>Transfer partners</strong> ({partners.length}): verify ratios before transferring</summary>
        <div className="scroll-x">
          <table className="plain">
            <thead><tr><th>From</th><th>Partner</th><th>Ratio</th><th>Notes</th></tr></thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id}><td>{p.currency}</td><td>{p.partner}</td><td>1:{p.ratio}</td><td><small>{p.notes}</small></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
