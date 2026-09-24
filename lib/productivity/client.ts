/**
 * Browser side of Fast Re-entry (PRD §87, §88, §128, §215; NAV-03 PANEL-04).
 *
 * Search Home keeps one answer in this tab's memory, for the context it was
 * read in, reusable for 30 seconds: reopening the panel may paint it while one
 * fresh read runs. Nothing about Favorites or Recent Work is written to
 * sessionStorage or localStorage; entries older versions left there are
 * removed once. A star toggled in one tab is broadcast to the others, which
 * drop their copy.
 */

export const MY_WORK_CHANNEL = "nesto-my-work";
const LEGACY_CACHE_PREFIX = "nesto-search-home:";
export const SEARCH_HOME_TTL_MS = 30_000;

export type MyWorkChange = { kind: "favorite"; entityType: string; entityId: string; favorite: boolean } | { kind: "recent" };

let home: { key: string; value: unknown; at: number } | null = null;

export function publishMyWorkChange(change: MyWorkChange): void {
  clearSearchHomeCache();
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(MY_WORK_CHANNEL);
  channel.postMessage(change);
  channel.close();
}

export function subscribeMyWork(listener: (change: MyWorkChange) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(MY_WORK_CHANNEL);
  channel.onmessage = (event: MessageEvent<MyWorkChange>) => {
    if (event.data?.kind) {
      home = null;
      listener(event.data);
    }
  };
  return () => channel.close();
}

/** The last Home answer for this context, if it is under 30 seconds old. */
export function readSearchHomeCache<T>(contextKey: string, now = Date.now()): T | null {
  if (!home || home.key !== contextKey || now - home.at >= SEARCH_HOME_TTL_MS) return null;
  return home.value as T;
}

export function writeSearchHomeCache(contextKey: string, value: unknown, now = Date.now()): void {
  home = { key: contextKey, value, at: now };
}

/** Removes the payloads older versions kept in sessionStorage. */
export function removeLegacySearchHomeCache(): void {
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(LEGACY_CACHE_PREFIX)) sessionStorage.removeItem(key);
  } catch {
    // Nothing stored, or storage blocked.
  }
}

/** Sign-out, a user switch, or a change made in any tab. */
export function clearSearchHomeCache(): void {
  home = null;
  removeLegacySearchHomeCache();
}
