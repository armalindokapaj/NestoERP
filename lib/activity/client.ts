/**
 * Browser side of the Activity Center (Activity Center PRD §79, §123-§126,
 * §191-§194; NAV-03 ACTIVITY-04, ACTIVITY-06).
 *
 * A read, seen or acknowledged change is published once in this tab and
 * broadcast once to the others. A message carries a version, a random id and
 * a fixed kind, nothing about the item: it only tells a tab to read again
 * under its own session. Subscribers drop an id they have already seen.
 *
 * Payloads are kept in the tab's memory by the Activity controller, never in
 * sessionStorage; entries an older version left there are removed once.
 */

export const ACTIVITY_CHANNEL = "nesto-activity";
const LEGACY_CACHE_PREFIX = "nesto-activity:";
const SEEN_LIMIT = 50;
const SEEN_FOR_MS = 120_000;

export type ActivityChangeKind = "read" | "seen" | "acknowledged" | "changed";
type Message = { v: 1; id: string; kind: ActivityChangeKind };

const local = new Set<(kind: ActivityChangeKind) => void>();
const resets = new Set<() => void>();

function eventId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function publishActivityChange(kind: ActivityChangeKind = "changed"): void {
  for (const listener of local) listener(kind);
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(ACTIVITY_CHANNEL);
  channel.postMessage({ v: 1, id: eventId(), kind } satisfies Message);
  channel.close();
}

/**
 * Changes from this tab and from the others, each delivered once. A message
 * from an older version (no id) counts as a plain change.
 */
export function subscribeActivity(listener: (kind: ActivityChangeKind) => void): () => void {
  local.add(listener);
  const seen = new Map<string, number>();
  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(ACTIVITY_CHANNEL);
    channel.onmessage = (event: MessageEvent<Partial<Message>>) => {
      const id = typeof event.data?.id === "string" ? event.data.id : null;
      const now = Date.now();
      for (const [key, at] of seen) if (now - at > SEEN_FOR_MS) seen.delete(key);
      if (id) {
        if (seen.has(id)) return;
        seen.set(id, now);
        while (seen.size > SEEN_LIMIT) seen.delete(seen.keys().next().value as string);
      }
      const kind = event.data?.kind;
      listener(kind === "read" || kind === "seen" || kind === "acknowledged" ? kind : "changed");
    };
  }
  return () => {
    local.delete(listener);
    channel?.close();
  };
}

/** A controller registers here so sign-out and a user switch empty it at once. */
export function onActivityReset(listener: () => void): () => void {
  resets.add(listener);
  return () => resets.delete(listener);
}

/** Removes the payload entries older versions kept in sessionStorage. */
export function removeLegacyActivityCache(): void {
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(LEGACY_CACHE_PREFIX)) sessionStorage.removeItem(key);
  } catch {
    // Nothing stored, or storage blocked.
  }
}

/** Sign-out and demo-user switch: everything this tab holds about Activity goes, synchronously. */
export function clearActivityCache(): void {
  removeLegacyActivityCache();
  for (const listener of resets) listener();
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
