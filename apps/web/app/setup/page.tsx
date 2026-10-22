import { KNOWN_KEYS } from "@rave-run/providers";
import { providerHealth } from "@/lib/data";
import { fmtWhen } from "@/lib/format";
import { keyStatus } from "@/lib/keys";

export const dynamic = "force-dynamic";

export default async function Setup() {
  const keys = keyStatus();
  const health = await providerHealth();
  return (
    <>
      <h1>API keys</h1>
      <p className="muted">
        Keys live in the server's <code>.env</code> file and are never shown here. Step-by-step signup instructions are in <code>docs/API_KEYS.md</code>.
        Without a key, that source is skipped and the app says &ldquo;couldn&apos;t check&rdquo;. It never makes up prices.
      </p>
      <div className="card scroll-x">
        <table className="plain">
          <thead><tr><th>Key</th><th>Used for</th><th>Needed from</th><th>Status</th></tr></thead>
          <tbody>
            {KNOWN_KEYS.map((k) => (
              <tr key={k.env}>
                <td><code>{k.env}</code></td>
                <td>{k.purpose}</td>
                <td>step {k.step}</td>
                <td>{keys[k.env] ? <span className="chip good">set</span> : <span className={`chip ${k.step <= 3 ? "bad" : ""}`}>missing</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Last 48 hours</h2>
      {health.length === 0 && <p className="muted">No provider runs yet. The worker runs flights daily at 5:10 AM ET (or run <code>npm run worker:once</code>).</p>}
      {health.map((h) => (
        <div key={h.id} className={`alert ${h.ok ? "" : "bad"}`}>
          <strong>{h.kind}</strong> via {h.provider} · {fmtWhen(h.startedAt)} · {h.ok ? `${h.results} prices, ${h.queries} searches` : "failed"}
          {h.error && <pre style={{ whiteSpace: "pre-wrap", margin: "6px 0 0", fontSize: 12 }}>{h.error}</pre>}
        </div>
      ))}
    </>
  );
}
