/**
 * Route preparation on deliberate intent (NAV-03 §7, PREFETCH-01..05).
 *
 * Five exact destinations may be prepared, and only where the permitted
 * navigation already offers them. A pointer resting on one for 150 ms, or
 * focus staying 100 ms, asks this scheduler; it issues at most one call every
 * 1.5 s and four a minute per tab, keeps one queued candidate (the latest),
 * and never prepares the same destination twice within 60 s for one context.
 * Nothing is issued while hidden, offline, on Save-Data or 2g, or while a
 * navigation or workspace switch is pending.
 *
 * `router.prefetch` has no completion signal, so an issue is recorded as
 * issued, never as prepared or as a cache hit. Clearing these records does not
 * clear the framework's router cache.
 */

export const INTENT_ROUTES = ["/dashboard", "/projects", "/clients", "/tasks", "/finance"] as const;
export type IntentRoute = (typeof INTENT_ROUTES)[number];

export const HOVER_DWELL_MS = 150;
export const FOCUS_DWELL_MS = 100;
export const ISSUE_GAP_MS = 1_500;
export const ISSUES_PER_MINUTE = 4;
export const DEDUPE_MS = 60_000;
export const DEDUPE_LIMIT = 20;

/** Only an exact, same-origin, approved path: no query, no fragment, nothing under it. */
export function intentRoute(href: string, origin?: string): IntentRoute | null {
  if (!href.startsWith("/") || href.startsWith("//")) {
    if (!origin) return null;
    try {
      const url = new URL(href);
      if (url.origin !== origin) return null;
      href = url.pathname + url.search + url.hash;
    } catch {
      return null;
    }
  }
  if (href.includes("?") || href.includes("#")) return null;
  return (INTENT_ROUTES as readonly string[]).includes(href) ? (href as IntentRoute) : null;
}

export type IntentEnvironment = {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Visible, online, no Save-Data or 2g. */
  allowed(): boolean;
  /** A navigation, workspace switch or unsaved-changes question is pending. */
  busy(): boolean;
  currentPath(): string;
};

export type IntentScheduler = ReturnType<typeof createIntentScheduler>;

export function createIntentScheduler(options: { prefetch: (route: IntentRoute) => void; environment: IntentEnvironment; contextKey: string }) {
  const env = options.environment;
  let contextKey = options.contextKey;
  const issued: number[] = [];
  const recent = new Map<string, number>();
  let candidate: IntentRoute | null = null;
  let dwell: unknown = null;
  let queued: unknown = null;
  let enabled = true;

  function forgetOld(now: number) {
    while (issued.length && now - issued[0] >= 60_000) issued.shift();
    for (const [key, at] of recent) if (now - at >= DEDUPE_MS) recent.delete(key);
  }

  function eligible(route: IntentRoute, now: number): boolean {
    if (!enabled || !env.allowed() || env.busy()) return false;
    if (env.currentPath() === route) return false;
    return !recent.has(`${contextKey}:${route}`) || now - (recent.get(`${contextKey}:${route}`) ?? 0) >= DEDUPE_MS;
  }

  /** Issues the queued candidate if the budget allows now, or when it will. */
  function drain() {
    queued = null;
    if (!candidate) return;
    const now = env.now();
    forgetOld(now);
    if (!eligible(candidate, now)) {
      candidate = null;
      return;
    }
    const gapReady = issued.length === 0 || now - issued[issued.length - 1] >= ISSUE_GAP_MS;
    const budgetReady = issued.length < ISSUES_PER_MINUTE;
    if (gapReady && budgetReady) {
      const route = candidate;
      candidate = null;
      issued.push(now);
      recent.set(`${contextKey}:${route}`, now);
      while (recent.size > DEDUPE_LIMIT) recent.delete(recent.keys().next().value as string);
      options.prefetch(route);
      return;
    }
    const waitGap = gapReady ? 0 : issued[issued.length - 1] + ISSUE_GAP_MS - now;
    const waitBudget = budgetReady ? 0 : issued[0] + 60_000 - now;
    queued = env.setTimeout(drain, Math.max(waitGap, waitBudget));
  }

  function cancelDwell() {
    if (dwell !== null) env.clearTimeout(dwell);
    dwell = null;
  }

  return {
    /** A pointer rests on, or focus lands on, an approved link. */
    intent(route: IntentRoute, kind: "hover" | "focus") {
      cancelDwell();
      dwell = env.setTimeout(
        () => {
          dwell = null;
          candidate = route; // the latest intent replaces an older queued one
          if (queued !== null) env.clearTimeout(queued);
          drain();
        },
        kind === "hover" ? HOVER_DWELL_MS : FOCUS_DWELL_MS,
      );
    },
    /** Leaving or blurring before the dwell ends cancels it; unissued work only. */
    leave(route: IntentRoute) {
      cancelDwell();
      if (candidate === route) {
        candidate = null;
        if (queued !== null) env.clearTimeout(queued);
        queued = null;
      }
    },
    /** A changed context or identity forgets this tab's records and anything unissued (PREFETCH-05). */
    reset(nextContextKey: string) {
      contextKey = nextContextKey;
      cancelDwell();
      if (queued !== null) env.clearTimeout(queued);
      queued = null;
      candidate = null;
      recent.clear();
    },
    setEnabled(next: boolean) {
      enabled = next;
      if (!next) this.reset(contextKey);
    },
    /** For evidence and tests: issue times inside the last minute. */
    issuedInLastMinute(): number {
      forgetOld(env.now());
      return issued.length;
    },
  };
}
