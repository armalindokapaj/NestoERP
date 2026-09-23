/**
 * Browser side of Fast Re-entry (PRD §87, §88, §128, §215).
 *
 * The search panel keeps the last Favorites/Recent answer in sessionStorage so
 * it can paint at once and refresh behind; the key carries the user, so one
 * demo user never sees another's (§84, §85), and sign-out clears it (§87).
 * A star toggled in one tab is broadcast to the others, which drop their copy.
 */

export const MY_WORK_CHANNEL = "nesto-my-work";
const CACHE_PREFIX = "nesto-search-home:";

export type MyWorkChange = { kind: "favorite"; entityType: string; entityId: string; favorite: boolean } | { kind: "recent" };

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
    if (event.data?.kind) listener(event.data);
  };
  return () => channel.close();
}

export function readSearchHomeCache<T>(userKey: string): T | null {
  try {
    return JSON.parse(sessionStorage.getItem(CACHE_PREFIX + userKey) ?? "null") as T | null;
  } catch {
    return null;
  }
}

export function writeSearchHomeCache(userKey: string, value: unknown): void {
  try {
    sessionStorage.setItem(CACHE_PREFIX + userKey, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the panel simply loads fresh next time.
  }
}

/** Every user's cached panel — on sign-out, a user switch, or a change made in any tab. */
export function clearSearchHomeCache(): void {
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(CACHE_PREFIX)) sessionStorage.removeItem(key);
  } catch {
    // Nothing cached, or nothing reachable.
  }
}
