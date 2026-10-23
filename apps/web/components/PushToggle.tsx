"use client";

import { useEffect, useState } from "react";

function keyBytes(base64: string): Uint8Array {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Turn the daily-brief notification on or off for this device. */
export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<"loading" | "unsupported" | "insecure" | "off" | "on" | "denied" | "error">("loading");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    if (!window.isSecureContext) return setState("insecure");
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  if (!publicKey) return <p className="muted">Push needs VAPID keys on the server (see docs/API_KEYS.md, step 4).</p>;
  if (state === "loading") return <p className="muted">Checking this device…</p>;
  if (state === "insecure") return <p className="muted">Notifications need https. Open the app at its https address (the droplet, or Tailscale HTTPS) to turn them on.</p>;
  if (state === "unsupported") return <p className="muted">This browser can't receive notifications. On iPhone, add the app to your Home Screen first, then open it from there.</p>;
  if (state === "denied") return <p className="muted">Notifications are blocked for this site in your browser settings.</p>;

  async function turnOn() {
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey!) as BufferSource });
      const res = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error(`server said ${res.status}`);
      setState("on");
    } catch (e) {
      setDetail((e as Error).message);
      setState("error");
    }
  }
  async function turnOff() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("off");
  }

  return (
    <div className="row">
      {state === "on" ? (
        <>
          <span className="chip good">On for this device</span>
          <button type="button" className="ghost" onClick={turnOff}>Turn off</button>
        </>
      ) : (
        <button type="button" onClick={turnOn}>Turn on notifications on this device</button>
      )}
      {state === "error" && <small style={{ color: "var(--bad)" }}>Couldn&apos;t turn on: {detail}</small>}
    </div>
  );
}
