/**
 * Navigation feedback, the state behind it (NAV-01 NAV-01..NAV-03).
 *
 * Presentation and correlation only: a ticket says "the person asked to go
 * there and we have not arrived yet". It never grants a route, and nothing
 * reads it to decide access.
 *
 * Tickets are numbered from one counter. Only the current ticket may settle,
 * so a late callback from an earlier navigation cannot clear the feedback of
 * a newer one (§7 NAV-01, N06). Framework-free, so it is unit-tested on its own.
 */

export type NavigationSource =
  | "sidebar"
  | "mobile"
  | "tab"
  | "record"
  | "breadcrumb"
  | "dashboard"
  | "quick-create"
  | "workspace"
  | "history";

export type NavigationTicket = {
  id: number;
  /** pathname + query of the destination, or null when it is not known up front (Back/Forward). */
  destination: string | null;
  source: NavigationSource;
  startedAt: number;
};

export type NavigationFeedbackSnapshot = {
  ticket: NavigationTicket | null;
  /** The wait passed SLOW_AFTER_MS; the shell says so and keeps navigation usable (NAV-03). */
  slow: boolean;
};

export const SLOW_AFTER_MS = 10_000;

type Location = { origin: string; pathname: string; search: string };

/**
 * The pathname + query a link would commit, or null when following it is not a
 * route change this tab tracks: another origin, a hash on the same document,
 * or exactly the page already shown (NAV-02, N03, N04).
 */
export function trackedDestination(href: string, current: Location): string | null {
  let url: URL;
  try {
    url = new URL(href, `${current.origin}${current.pathname}${current.search}`);
  } catch {
    return null;
  }
  if (url.origin !== current.origin) return null;
  const destination = `${url.pathname}${url.search}`;
  if (destination === `${current.pathname}${current.search}`) return null;
  return destination;
}

export type FeedbackStore = ReturnType<typeof createFeedbackStore>;

export function createFeedbackStore(options: { now?: () => number; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (handle: unknown) => void } = {}) {
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let counter = 0;
  let snapshot: NavigationFeedbackSnapshot = { ticket: null, slow: false };
  let slowTimer: unknown = null;
  /** The ticket that started a workspace switch of its own: that one WORKSPACE_CHANGED does not end it (QC-11). */
  let ownsSwitch: number | null = null;
  const listeners = new Set<() => void>();

  function emit(next: NavigationFeedbackSnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function clear() {
    if (slowTimer !== null) clearTimer(slowTimer);
    slowTimer = null;
    ownsSwitch = null;
    if (snapshot.ticket || snapshot.slow) emit({ ticket: null, slow: false });
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,

    /** An accepted navigation: a new current ticket, painted at once (NAV-03). */
    begin(destination: string | null, source: NavigationSource, opts: { ownsWorkspaceSwitch?: boolean } = {}): NavigationTicket {
      if (slowTimer !== null) clearTimer(slowTimer);
      const ticket: NavigationTicket = { id: ++counter, destination, source, startedAt: now() };
      ownsSwitch = opts.ownsWorkspaceSwitch ? ticket.id : null;
      slowTimer = setTimer(() => {
        slowTimer = null;
        if (snapshot.ticket?.id === ticket.id) emit({ ticket, slow: true });
      }, SLOW_AFTER_MS);
      emit({ ticket, slow: false });
      return ticket;
    },

    /** Ends this ticket's feedback — only while it is still the current one. */
    settle(ticket: NavigationTicket | null | undefined) {
      if (ticket && snapshot.ticket?.id === ticket.id) clear();
    },

    /** The URL committed (to the destination, a redirect's, or anywhere): whatever was pending is over. */
    committed() {
      clear();
    },

    /** An error boundary rendered, or identity changed: nothing pending survives. */
    reset() {
      clear();
    },

    /** A workspace changed. The navigation that switched it keeps going, once; any other ends (QC-11, NAV-03). */
    workspaceChanged() {
      if (snapshot.ticket && ownsSwitch === snapshot.ticket.id) {
        ownsSwitch = null;
        return;
      }
      clear();
    },

    isPendingTo(destination: string | null) {
      return destination !== null && snapshot.ticket?.destination === destination;
    },
  };
}
