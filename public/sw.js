/*
 * NESTO offline shell (MOB-09 §65, §66).
 *
 * What it does, and all it does:
 *  - keeps the offline workspace page (/offline) and the immutable build assets
 *    it loads, so the workspace opens with no network;
 *  - when a page navigation cannot reach the server, answers it with that
 *    workspace instead of a browser error page.
 *
 * What it never does: cache an /api response, a record, a document or a page
 * other than /offline. Business data lives only in the app's encrypted local
 * database, never here. Everything else goes straight to the network.
 */
const VERSION = "v1";
const SHELL_CACHE = `nesto-shell-${VERSION}`;
const ASSET_CACHE = `nesto-assets-${VERSION}`;
const SHELL_URL = "/offline";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("nesto-") && key !== SHELL_CACHE && key !== ASSET_CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

const STATIC = /\/_next\/static\//;

async function cacheAsset(url) {
  try {
    const cache = await caches.open(ASSET_CACHE);
    if (await cache.match(url)) return;
    const response = await fetch(url, { credentials: "same-origin" });
    if (response.ok) await cache.put(url, response.clone());
    // Fonts named inside a stylesheet are needed too.
    if (url.endsWith(".css") && response.ok) {
      const css = await response.clone().text();
      for (const match of css.matchAll(/url\((\/_next\/static\/[^)"']+)\)/g)) await cacheAsset(match[1]);
    }
  } catch {
    // An asset that cannot be fetched now is fetched when it is next used online.
  }
}

async function precacheShell() {
  const response = await fetch(SHELL_URL, { credentials: "same-origin", cache: "reload" });
  // Not signed in (a redirect to /login) or an error: there is nothing to keep.
  if (!response.ok || response.redirected) return;
  const cache = await caches.open(SHELL_CACHE);
  await cache.put(SHELL_URL, response.clone());
  const html = await response.text();
  const urls = new Set(Array.from(html.matchAll(/\/_next\/static\/[^"'\\\s)]+/g), (match) => match[0]));
  await Promise.all([...urls].map(cacheAsset));
}

self.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.type === "PRECACHE") event.waitUntil(precacheShell().catch(() => undefined));
  if (message.type === "CACHE_ASSETS" && Array.isArray(message.urls)) {
    event.waitUntil(Promise.all(message.urls.filter((url) => typeof url === "string" && STATIC.test(url) && new URL(url).origin === self.location.origin).map((url) => cacheAsset(new URL(url).pathname + new URL(url).search))));
  }
  if (message.type === "CLEAR") event.waitUntil(Promise.all([caches.delete(SHELL_CACHE), caches.delete(ASSET_CACHE)]));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Immutable, content-hashed build files: the cached copy is always right.
  if (STATIC.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })(),
    );
    return;
  }

  // A page load that cannot reach the server gets the offline workspace. A slow
  // server is waited for — only a failure falls back.
  if (request.mode === "navigate") {
    if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return;
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (url.pathname === SHELL_URL && response.ok && !response.redirected) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put(SHELL_URL, response.clone());
          }
          return response;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const shell = await cache.match(SHELL_URL, { ignoreSearch: true });
          if (!shell) throw new Error("offline");
          // The page asked for is not the workspace: go there, remembering what was asked for, so the
          // workspace can open the nearest thing the device holds (a project, a task).
          if (url.pathname !== SHELL_URL) return Response.redirect(new URL(`${SHELL_URL}?from=${encodeURIComponent(url.pathname + url.search)}`, self.location.origin).href, 302);
          return shell;
        }
      })(),
    );
  }
});
