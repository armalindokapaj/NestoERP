/**
 * The offline shell's service worker, from the page's side (MOB-09 §65, §66).
 *
 * `public/sw.js` caches the offline workspace (`/offline`) and the immutable
 * build assets it needs, and answers a navigation that cannot reach the server
 * with that workspace. It never caches an API response or a record.
 * Registered only where a service worker exists — a browser, and Android's
 * WebView. iOS runs one only for App-Bound Domains, which is a binary setting
 * (docs/mobile/offline-architecture.md); there this does nothing.
 */

const enabled = (): boolean =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator && (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_OFFLINE_SW === "1");

export async function registerOfflineShell(): Promise<boolean> {
  if (!enabled()) return false;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const ready = await navigator.serviceWorker.ready;
    (ready.active ?? registration.active)?.postMessage({ type: "PRECACHE" });
    return true;
  } catch {
    return false;
  }
}

/** Tells the worker which build assets this page loaded, so the next cold start works with no network. */
export function reportLoadedAssets(): void {
  if (!enabled() || !navigator.serviceWorker.controller) return;
  const urls = performance.getEntriesByType("resource").map((entry) => entry.name).filter((url) => url.includes("/_next/static/"));
  navigator.serviceWorker.controller.postMessage({ type: "CACHE_ASSETS", urls });
}

/** Removes everything the worker holds. Called when a person discards the device's offline data. */
export async function clearOfflineShell(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  registration?.active?.postMessage({ type: "CLEAR" });
}
