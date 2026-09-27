// The Project viewer's asset cache (ported from the Rozaris 3D viewer).
//
// Registered by the Company 3D viewer with a scope of that one viewer page, so
// it never controls any other NESTO page. Cache-first is only correct because
// every URL it caches is content-immutable: Next's hashed build output and the
// self-hosted decoder, LUT and texture files under /3d/.
//
// Deliberately NOT cached, unlike on Rozaris:
// - page documents: they are signed-in, permission-trimmed responses;
// - published models: they arrive on short-lived signed URLs, and a copy kept
//   here would outlive a revoked access.
const ASSET_CACHE = "nesto-3d-assets-v1";
const ASSET_MAX_ENTRIES = 120;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith("nesto-3d-") && name !== ASSET_CACHE).map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

function shouldCache(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/3d/");
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  const overBy = keys.length - maxEntries;
  if (overBy <= 0) return;
  await Promise.all(keys.slice(0, overBy).map((key) => cache.delete(key)));
}

async function cacheFirst(event) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (response.ok && response.type === "basic") {
    const copy = response.clone();
    event.waitUntil(cache.put(event.request, copy).then(() => trimCache(cache, ASSET_MAX_ENTRIES)));
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  if (shouldCache(event.request)) event.respondWith(cacheFirst(event));
});
