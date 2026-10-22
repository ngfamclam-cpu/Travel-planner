import { prisma } from "@rave-run/db";
import { TICKET_PLATFORMS } from "@rave-run/core";
import { resetAirports, savePoints, saveSettings, saveTicketSettings } from "@/app/actions";
import { getCards, getPoints, getSettings } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const [s, cards, points, partners] = await Promise.all([
    getSettings(),
    getCards(),
    getPoints(),
    prisma.transferPartner.findMany({ orderBy: [{ currency: "asc" }, { partner: "asc" }] }),
  ]);

  return (
    <>
      <h1>Settings</h1>
      <form action={saveSettings}>
        <section className="card" id="airports">
          <h2 style={{ marginTop: 0 }}>Origin airports</h2>
          <p className="muted">Positioning = round-trip cost of getting to that airport (bus/train/parking). It's added to every fare from it.</p>
          <div className="scroll-x">
            <table className="plain">
              <thead><tr><th>Search</th><th>Airport</th><th>Positioning $</th></tr></thead>
              <tbody>
                {s.originAirports.map((a) => (
                  <tr key={a.code}>
                    <td><input type="checkbox" name={`use_${a.code}`} defaultChecked={a.enabled !== false} /></td>
                    <td>{a.code} <small>{a.label}</small></td>
                    <td><input name={`pos_${a.code}`} inputMode="decimal" defaultValue={a.positioningCost} style={{ maxWidth: 110 }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Trips &amp; hotels</h2>
          <div className="fields">
            <div><label>Default flex days (±)</label><input name="flexDays" type="number" min={0} max={3} defaultValue={s.flexDays} /></div>
            <div><label>Hotel min stars</label><input name="hotelMinStars" type="number" step="0.5" defaultValue={s.hotelMinStars} /></div>
            <div><label>Hotel min rating (/10)</label><input name="hotelMinRating10" type="number" step="0.1" defaultValue={s.hotelMinRating10} /></div>
            <div><label>Points floor (¢ per point)</label><input name="cppFloor" type="number" step="0.1" defaultValue={s.cppFloor} /></div>
          </div>
        </section>

        <section className="card" id="cards">
          <h2 style={{ marginTop: 0 }}>Cards</h2>
          <div className="fields">
            <div>
              <label>Citi Strata version</label>
              <select name="citiStrataVersion" defaultValue={s.cards.citiStrataVersion}>
                <option value="unknown">Not sure yet</option>
                <option value="strata">Strata (no annual fee)</option>
                <option value="strata_premier">Strata Premier</option>
                <option value="strata_elite">Strata Elite</option>
              </select>
            </div>
            <div>
              <label>Any Chase Sapphire (or Ink Preferred)?</label>
              <select name="hasChaseSapphire" defaultValue={s.cards.hasChaseSapphire}>
                <option value="unknown">Not sure yet</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            <div>
              <label>Chase Freedom version</label>
              <select name="chaseFreedomVersion" defaultValue={s.cards.chaseFreedomVersion}>
                <option value="unknown">Not sure yet</option>
                <option value="freedom">Freedom (rotating 5%)</option>
                <option value="freedom_flex">Freedom Flex</option>
                <option value="freedom_unlimited">Freedom Unlimited</option>
              </select>
            </div>
          </div>
          <div className="scroll-x" style={{ marginTop: 12 }}>
            <table className="plain">
              <thead><tr><th>Card</th><th>Foreign fee</th><th>Points</th><th>Transfers</th><th>Notes</th></tr></thead>
              <tbody>
                {cards.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}{c.needsSetup && <> <span className="chip warn">setup</span></>}</td>
                    <td>{c.foreignFeePct == null ? "?" : `${Number(c.foreignFeePct)}%`}</td>
                    <td>{c.pointsCurrency}</td>
                    <td>{c.transferEnabled == null ? "?" : c.transferEnabled ? "yes" : "no"}</td>
                    <td><small>{c.notes}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted"><small>Earn rules are seed values from the spec. Card terms change, so verify them. The card picker arrives in build step 7.</small></p>
        </section>

        <section className="card" id="status">
          <h2 style={{ marginTop: 0 }}>Status</h2>
          <div className="fields">
            <div className="wide"><label>Airline status</label><input name="statusAirline" defaultValue={s.status.airline} placeholder="e.g. none, JetBlue Mosaic" /></div>
            <div className="wide"><label>Hotel status</label><input name="statusHotel" defaultValue={s.status.hotel} placeholder="e.g. Hilton Gold (Amex)" /></div>
          </div>
        </section>

        <section className="card" id="brief">
          <h2 style={{ marginTop: 0 }}>Daily brief &amp; data</h2>
          <div className="fields">
            <div><label>Brief time (ET)</label><input name="briefTime" type="time" defaultValue={s.briefTime} /></div>
            <div><label><input type="checkbox" name="briefPush" defaultChecked={s.briefChannels.push} /> Push</label></div>
            <div><label><input type="checkbox" name="briefEmail" defaultChecked={s.briefChannels.email} /> Email</label></div>
            <div><label>SerpApi searches / month</label><input name="serpapiMonthlyQuota" type="number" defaultValue={s.serpapiMonthlyQuota} /></div>
            <div><label>Free flight source: requests / day</label><input name="freeFlightDailyRequests" type="number" min={0} defaultValue={s.freeFlightDailyRequests} /></div>
          </div>
          <p className="muted"><small>The free flight source makes one Google Flights request per airport pair, spaced several seconds apart. Keep it modest (≈100–150/day) so Google doesn't block your server. Data tier: {s.dataTier}. The brief (step 8) and the savings meter (step 10) aren't built yet.</small></p>
        </section>

        <div className="row"><button type="submit">Save settings</button></div>
      </form>
      <form action={resetAirports} style={{ marginTop: 8 }}><button type="submit" className="ghost">Reset airports to defaults</button></form>

      <section className="card" id="tickets">
        <h2 style={{ marginTop: 0 }}>Ticket fees</h2>
        <p className="muted">
          When a site shows prices before fees, this % is added to compare all-in prices. These are rough estimates: check a real checkout and adjust.
          A blank field uses the default shown.
        </p>
        <form action={saveTicketSettings} className="fields">
          {Object.values(TICKET_PLATFORMS)
            .filter((p) => !p.listedIncludesFees)
            .map((p) => (
              <div key={p.id}>
                <label>{p.name} fee %</label>
                <input name={`fee_${p.id}`} inputMode="decimal" defaultValue={s.ticketFeePct[p.id] ?? ""} placeholder={String(p.defaultFeePct)} />
              </div>
            ))}
          <div><label>CrowdVolt alert: ask within $ of bid</label><input name="crowdvoltGapAlert" inputMode="decimal" defaultValue={s.crowdvoltGapAlert} /></div>
          <div className="wide"><button type="submit">Save ticket settings</button></div>
        </form>
      </section>

      <section className="card" id="points">
        <h2 style={{ marginTop: 0 }}>Points balances</h2>
        <p className="muted">Entered by hand: no card issuer offers a balance API. Update monthly.</p>
        <form action={savePoints} className="fields">
          {points.map((p) => (
            <div key={p.id}><label>{p.currency}</label><input name={`pts_${p.currency}`} inputMode="numeric" defaultValue={p.balance} /></div>
          ))}
          <div className="wide"><button type="submit">Save balances</button></div>
        </form>
      </section>

      <details className="card">
        <summary><strong>Transfer partners</strong> ({partners.length})</summary>
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
