/* Betterservice ATV — service worker.
 *
 * Exists for one reason: a push notification can only be received by a service
 * worker. The page itself may be closed, the phone in someone's pocket; this is
 * the bit of the app that is still listening.
 *
 * Deliberately does NOT cache anything. An offline cache on a workshop app that
 * shows live job cards, stock and invoices would be worse than useless — stale
 * numbers that look current. If offline ever matters it should be designed, not
 * inherited from a boilerplate service worker.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  // A push with no readable payload still deserves a notification — something
  // arrived, and silence would be worse than a vague ping.
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_e) { data = {}; }

  const title = data.title || "Betterservice";
  const options = {
    body: data.body || "",
    // The badge/icon are what show in the notification shade.
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // tag collapses repeats: re-sending the same job's pick-up replaces the old
    // notification instead of stacking a second one.
    tag: data.tag || undefined,
    renotify: !!data.tag,
    requireInteraction: !!data.requireInteraction,
    data: { url: data.url || "/", mapsUrl: data.mapsUrl || null },
    actions: data.mapsUrl
      ? [{ action: "maps", title: "Open in Maps" }, { action: "open", title: "Open job" }]
      : [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  // Tapping "Open in Maps" goes straight to directions; tapping the body of the
  // notification opens the job card.
  const target = event.action === "maps" && d.mapsUrl ? d.mapsUrl : d.url || "/";

  event.waitUntil(
    (async () => {
      // Reuse a window that's already open on the app rather than piling up tabs.
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (c.url && new URL(c.url).origin === self.location.origin && "focus" in c) {
          await c.focus();
          if ("navigate" in c) { try { await c.navigate(target); } catch (_e) { /* cross-origin maps link */ } }
          if (event.action === "maps" && d.mapsUrl) { await self.clients.openWindow(d.mapsUrl); }
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});
