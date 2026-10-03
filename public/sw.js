const CACHE = "papot-mobile-shell-v2";

async function installCaptureShell() {
  const cache = await caches.open(CACHE);
  try {
    await cache.add("/capture");
  } catch {
    // The authenticated shell is also primed from the page after login.
  }
}

async function clearOldCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key !== CACHE)
      .map((key) => caches.delete(key)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(installCaptureShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      clearOldCaches(),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;

        if (request.mode === "navigate") {
          const capture = await caches.match("/capture");
          if (capture) return capture;
        }

        throw new Error("OFFLINE_RESOURCE_UNAVAILABLE");
      }),
  );
});
