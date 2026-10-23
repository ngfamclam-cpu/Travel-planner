// Minimal offline support: network-first for pages, falling back to the last cached copy.
const CACHE = "rave-run-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (req.mode === "navigate" || req.url.includes("/_next/static/"))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || new Response("Offline", { status: 503 }))),
  );
});

// Daily brief notification (sent by the worker).
self.addEventListener("push", (e) => {
  let msg = { title: "Rave Run", body: "Your daily brief is ready", url: "/brief" };
  try {
    msg = { ...msg, ...e.data.json() };
  } catch {}
  e.waitUntil(self.registration.showNotification(msg.title, { body: msg.body, icon: "/icon.svg", badge: "/icon.svg", data: { url: msg.url } }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/brief";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) if ("focus" in w) return w.navigate(url).then(() => w.focus());
      return self.clients.openWindow(url);
    }),
  );
});
