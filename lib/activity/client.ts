/**
 * Browser side of the Activity Center (Activity Center PRD §79, §123-§126, §191-§194).
 *
 * The panel paints its last answer at once from this tab's sessionStorage and
 * refreshes behind it. Keys carry the user, so one demo user never sees
 * another's, and sign-out or a user switch clears them. A read, seen or
 * acknowledged change in one tab is broadcast so the others refresh their badge.
 */

export const ACTIVITY_CHANNEL = "nesto-activity";
const CACHE_PREFIX = "nesto-activity:";

export function publishActivityChange(): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(ACTIVITY_CHANNEL);
  channel.postMessage({ at: Date.now() });
  channel.close();
}

export function subscribeActivity(listener: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(ACTIVITY_CHANNEL);
  channel.onmessage = () => listener();
  return () => channel.close();
}

export function readActivityCache<T>(key: string): T | null {
  try {
    return JSON.parse(sessionStorage.getItem(CACHE_PREFIX + key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

export function writeActivityCache(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the panel loads fresh next time.
  }
}

export function clearActivityCache(): void {
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(CACHE_PREFIX)) sessionStorage.removeItem(key);
  } catch {
    // Nothing cached, or nothing reachable.
  }
}

/** "4 min ago", in the reader's language. */
export function relativeTime(iso: string, locale: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(0, "second");
}
