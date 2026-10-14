const CACHE_NAME = "cannvas-inventory-v4";
const APP_SHELL = [
  "/inventory/",
  "/inventory/manifest.webmanifest",
  "/inventory/icon-192.png",
  "/inventory/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith("cannvas-inventory-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ),
    ),
  );
  self.clients.claim();
  event.waitUntil(moveToStandalone());
});

async function moveToStandalone() {
  try {
    const response = await fetch("/inventory/migration.json", { cache: "no-store" });
    const migration = await response.json();
    if (migration.origin !== "https://inventory.mikecann.app") return false;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(windows.map(async client => {
      const current = new URL(client.url);
      if (!current.pathname.startsWith("/inventory")) return;
      const destination = new URL("/", migration.origin);
      destination.search = current.search;
      destination.hash = current.hash;
      await client.navigate(destination.href);
    }));
    await self.registration.unregister();
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith("cannvas-inventory-")).map(name => caches.delete(name)));
    return true;
  } catch {
    // An offline device can try again the next time it opens the app.
    return false;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate" && url.pathname.startsWith("/inventory")) {
    event.respondWith(
      moveToStandalone().then(moved => {
        if (!moved) return fetch(request);
        const destination = new URL("/", "https://inventory.mikecann.app");
        destination.search = url.search;
        return Response.redirect(destination.href, 302);
      })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put("/inventory/", copy));
          }
          return response;
        })
        .catch(() => caches.match("/inventory/")),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/inventory/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const refresh = fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
        return cached || refresh;
      }),
    );
  }
});
