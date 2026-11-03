import type { SectionAnchor } from "@/lib/ui/ruler-math";

/**
 * Coming Back to a page with sections (UI-02 §8.6, journey J01).
 *
 * Every page here opens at its top (components/navigation/scroll-to-top.tsx),
 * and the browser's own scroll restoration is off, so nothing puts a reader
 * back where they were. A page that registers sections can: when it is left it
 * remembers the section being read and the distance into it, and when Back or
 * Forward returns to it, it goes to that place in the page as it is now
 * (`anchorTarget`, lib/ui/ruler-math.ts) — not to a pixel position or a
 * percentage, which are wrong once the content above has changed.
 *
 * A page without sections — a list, a record — is brought back the same way
 * from the rows and headings it does have: lib/navigation/scroll-memory.ts,
 * through the same store and the same watch (UI-02 §7.4).
 *
 * What is remembered is a section id and a number, per address, for this tab:
 * sessionStorage, under a `nesto.` key, so it goes with the tab and is emptied
 * with the session (components/layout/user-scoped-state.ts). The first half of
 * this file is pure and held by tests; the second half is the storage and the
 * one fact the browser has to be asked — whether this arrival was a traversal.
 */

export const RETURN_STORAGE_KEY = "nesto.ui.section-return";
/** Addresses remembered at once; the oldest goes first. */
export const RETURN_LIMIT = 40;

export type ReturnEntry = { key: string; anchor: SectionAnchor };

/** A page's address without its hash: a section jump writes the hash, and is still the same page. */
export function returnKey(pathname: string, search: string): string {
  const query = search.replace(/^\?/, "");
  return query ? `${pathname}?${query}` : pathname;
}

/** What storage holds, oldest first. Anything that is not exactly an entry is dropped, never repaired. */
export function parseReturns(raw: string | null | undefined): ReturnEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: ReturnEntry[] = [];
  for (const item of parsed) {
    if (!Array.isArray(item) || item.length !== 3) continue;
    const [key, id, offset] = item as unknown[];
    if (typeof key !== "string" || typeof id !== "string" || !id || typeof offset !== "number" || !Number.isFinite(offset)) continue;
    entries.push({ key, anchor: { id, offset } });
  }
  return entries;
}

export function serializeReturns(entries: readonly ReturnEntry[]): string {
  return JSON.stringify(entries.map((entry) => [entry.key, entry.anchor.id, Math.round(entry.anchor.offset)]));
}

/** One address's place, set or — `null`, a page left at its top — forgotten. The newest is last; the oldest fall off. */
export function withReturn(entries: readonly ReturnEntry[], key: string, anchor: SectionAnchor | null, limit: number = RETURN_LIMIT): ReturnEntry[] {
  const rest = entries.filter((entry) => entry.key !== key);
  if (anchor) rest.push({ key, anchor });
  return rest.slice(Math.max(0, rest.length - Math.max(1, limit)));
}

export function findReturn(entries: readonly ReturnEntry[], key: string): SectionAnchor | null {
  return entries.find((entry) => entry.key === key)?.anchor ?? null;
}

/* ------------------------------------------------------------------ */

function read(): ReturnEntry[] {
  try {
    return parseReturns(window.sessionStorage.getItem(RETURN_STORAGE_KEY));
  } catch {
    // Storage is optional: without it a page opens at its top, as it always has.
    return [];
  }
}

/** Called as a page with sections is left. */
export function rememberReturn(key: string, anchor: SectionAnchor | null): void {
  try {
    const next = withReturn(read(), key, anchor);
    if (next.length) window.sessionStorage.setItem(RETURN_STORAGE_KEY, serializeReturns(next));
    else window.sessionStorage.removeItem(RETURN_STORAGE_KEY);
  } catch {
    /* See `read`. */
  }
}

export function recallReturn(key: string): SectionAnchor | null {
  return findReturn(read(), key);
}

/**
 * The address whose page keeps its own place by section: a mounted scroll
 * ruler. Every other page's place is kept from its rows and headings
 * (lib/navigation/scroll-memory.ts), and one address has one keeper.
 */
let claimed: string | null = null;

export function claimReturns(key: string): () => void {
  claimed = key;
  return () => {
    if (claimed === key) claimed = null;
  };
}

export function returnsClaimed(key: string): boolean {
  return claimed === key;
}

/** The address the last Back or Forward arrived at, until a page takes it. */
let traversed: string | null = null;
let documentAsked = false;

function here(): string {
  return returnKey(window.location.pathname, window.location.search);
}

/** A document that was itself loaded by Back or Forward — a reload in between, another site — is a traversal to its own address. */
function askDocument() {
  if (documentAsked) return;
  documentAsked = true;
  const [entry] = window.performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  if (entry?.type === "back_forward") traversed = here();
}

/**
 * The history entry the browser is on, where it says (the Navigation API,
 * which lib/unsaved/history-guard.ts also reads). An entry keeps its key when
 * it is replaced and gets it back when it is returned to.
 */
function currentEntry(): string | null {
  const key = (window as unknown as { navigation?: { currentEntry?: { key?: unknown } | null } }).navigation?.currentEntry?.key;
  return typeof key === "string" && key ? key : null;
}

/** History entries a page of this document has been shown on. */
const shown = new Set<string>();
/** The arrival now on screen: which entry, at which address, and whether it is a return nobody has taken yet. */
let arrival: { entry: string; address: string; traversal: boolean } | null = null;

/**
 * Notes that `address` is on screen, and answers how it was arrived at.
 * Arriving on an entry that has been shown before is Back or Forward; a link
 * makes a new entry, and a replacement stays on the one it was on. Asked from
 * an effect of the page that arrived, this needs no event and no ordering: the
 * router renders a page it has kept inside its own `popstate` listener, before
 * any listener registered after it has heard of the traversal. A traversal the
 * unsaved-work guard holds back never renders, so it is never an arrival.
 * `null` where the browser has no Navigation API: `watchTraversals` answers there.
 */
export function noteArrival(address: string): { traversal: boolean } | null {
  const entry = currentEntry();
  if (entry === null) return null;
  if (!arrival || arrival.entry !== entry || arrival.address !== address) {
    arrival = { entry, address, traversal: arrival?.entry !== entry && shown.has(entry) };
    shown.add(entry);
  }
  return arrival;
}

/**
 * Listens for Back and Forward where the history entry cannot be asked
 * (`noteArrival`). The address has already changed when `popstate` fires, so
 * the page that then mounts finds its own address here. Mounted once, for
 * every page (components/navigation/section-return-watch.tsx): the page being
 * returned to is not on screen when the traversal happens.
 */
export function watchTraversals(): () => void {
  askDocument();
  // With the Navigation API the entry answers, and a late `popstate` must not answer a second time.
  if (currentEntry() !== null) return () => undefined;
  const onTraverse = () => {
    traversed = here();
  };
  window.addEventListener("popstate", onTraverse);
  return () => window.removeEventListener("popstate", onTraverse);
}

/** A page other than the one traversed to is on screen: that arrival is over, and a later link to the address is not a return. */
export function keepTraversal(pathname: string): void {
  if (traversed !== null && traversed !== pathname && !traversed.startsWith(`${pathname}?`)) traversed = null;
}

/** Whether this page was arrived at by Back or Forward. It answers yes once. */
export function takeTraversal(key: string): boolean {
  askDocument();
  const arrived = noteArrival(key);
  if (traversed === key) {
    traversed = null;
    if (arrived) arrived.traversal = false;
    return true;
  }
  if (!arrived?.traversal) return false;
  arrived.traversal = false;
  return true;
}
