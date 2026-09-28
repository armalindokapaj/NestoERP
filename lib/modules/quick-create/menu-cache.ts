import type { QuickCreateMenuDTO } from "@/lib/modules/quick-create/quick-create.service";

/**
 * The `+ Create` menu cache (NAV-01 QC-07..QC-09).
 *
 * Memory in this tab only, keyed by the shell's opaque context key and the
 * exact pathname the actions endpoint reads (it ignores the query, so the
 * query and hash are stripped; the record path is kept whole, so one project's
 * menu is never shown on another's). 30 s from a successful answer, at most 10
 * entries, least recently used out first. Failures and cancellations are never
 * stored; a legitimate empty menu is.
 *
 * It is a display optimisation, not a permission cache: every launch still
 * asks the server. A generation counter fences every commit — invalidating
 * bumps it, and an answer that started under an older generation, or for a key
 * that is no longer current, is dropped even if its fetch completed after an
 * abort (QC-09). Framework-free, so it is unit-tested on its own.
 */

export const MENU_TTL_MS = 30_000;
export const MENU_CAPACITY = 10;
export const REQUEST_TIMEOUT_MS = 10_000;

export type MenuFailure = "failed" | "offline" | "timeout" | "unauthenticated" | "context-changed";

export type MenuLoad =
  | { ok: true; menu: QuickCreateMenuDTO }
  | { ok: false; reason: MenuFailure | "cancelled" | "superseded" };

type Entry = { menu: QuickCreateMenuDTO; storedAt: number; usedAt: number };

export function menuPathname(pathname: string | null | undefined): string {
  const value = (pathname || "/").split(/[?#]/)[0] || "/";
  return value.startsWith("/") ? value : `/${value}`;
}

/** A body is a menu only when it has the shape the endpoint promises (QC-04: malformed ≠ empty). */
export function isMenuDTO(value: unknown): value is QuickCreateMenuDTO {
  if (!value || typeof value !== "object") return false;
  const menu = value as Partial<QuickCreateMenuDTO>;
  return (
    Array.isArray(menu.actions) &&
    menu.actions.every((action) => action && typeof action.key === "string" && typeof action.label === "string") &&
    typeof menu.contextKey === "string" &&
    !!menu.workspace &&
    (menu.workspace.scopeType === "GROUP" || menu.workspace.scopeType === "COMPANY")
  );
}

export type MenuFetcher = (pathname: string, signal: AbortSignal) => Promise<MenuLoad>;

export function createMenuCache(options: { fetcher: MenuFetcher; now?: () => number }) {
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, Entry>();
  let generation = 0;
  let contextKey = "";
  const inFlight = new Map<string, { generation: number; promise: Promise<MenuLoad>; controller: AbortController }>();

  const keyFor = (pathname: string) => `${contextKey}|${menuPathname(pathname)}`;

  function prune() {
    while (entries.size > MENU_CAPACITY) {
      let oldest: string | null = null;
      let oldestUse = Infinity;
      for (const [key, entry] of entries) {
        if (entry.usedAt < oldestUse) {
          oldest = key;
          oldestUse = entry.usedAt;
        }
      }
      if (oldest === null) break;
      entries.delete(oldest);
    }
  }

  return {
    get generation() {
      return generation;
    },

    /** A new identity or context: drop everything, in flight too (QC-08). */
    setContext(next: string) {
      if (next === contextKey) return;
      contextKey = next;
      this.invalidate();
    },

    /** Everything goes: cached menus, and the right of any in-flight answer to land. */
    invalidate() {
      generation += 1;
      entries.clear();
      for (const request of inFlight.values()) request.controller.abort();
      inFlight.clear();
    },

    /** A fresh entry for this pathname, or null. An expired one is never handed out as actionable (QC-07). */
    peek(pathname: string): QuickCreateMenuDTO | null {
      const entry = entries.get(keyFor(pathname));
      if (!entry) return null;
      if (now() - entry.storedAt >= MENU_TTL_MS) {
        entries.delete(keyFor(pathname));
        return null;
      }
      entry.usedAt = now();
      return entry.menu;
    },

    isFresh(pathname: string, menu: QuickCreateMenuDTO): boolean {
      const entry = entries.get(keyFor(pathname));
      return !!entry && entry.menu === menu && now() - entry.storedAt < MENU_TTL_MS;
    },

    /**
     * The menu for this pathname: from the cache, from a request already on its
     * way (joined, never duplicated — QC-09), or from one new request.
     */
    load(pathname: string): Promise<MenuLoad> {
      const cached = this.peek(pathname);
      if (cached) return Promise.resolve({ ok: true, menu: cached });
      const key = keyFor(pathname);
      const existing = inFlight.get(key);
      if (existing && existing.generation === generation) return existing.promise;

      const mine = generation;
      const expectedContext = contextKey;
      const controller = new AbortController();
      const promise = options
        .fetcher(menuPathname(pathname), controller.signal)
        .then((result): MenuLoad => {
          if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
          if (mine !== generation || expectedContext !== contextKey) return { ok: false, reason: "superseded" };
          if (!result.ok) return result;
          // The server drew it for someone or somewhere else: never shown, never stored (QC-02, Q15).
          if (result.menu.contextKey !== expectedContext) return { ok: false, reason: "context-changed" };
          entries.set(key, { menu: result.menu, storedAt: now(), usedAt: now() });
          prune();
          return result;
        });
      inFlight.set(key, { generation: mine, promise, controller });
      return promise;
    },

    /** Aborts the in-flight requests of this generation; their answers are dropped as well (QC-05). */
    cancel() {
      for (const request of inFlight.values()) request.controller.abort();
      inFlight.clear();
      generation += 1;
    },

    get size() {
      return entries.size;
    },
  };
}

export type MenuCache = ReturnType<typeof createMenuCache>;

/**
 * Fetch with a deadline (QC-05). An abort from the caller is a cancellation;
 * the deadline passing is a timeout; neither is ever turned into an empty answer.
 */
export async function fetchWithDeadline(input: string, init: RequestInit & { signal?: AbortSignal }, timeoutMs = REQUEST_TIMEOUT_MS): Promise<{ response: Response | null; failure: "timeout" | "cancelled" | "offline" | "failed" | null }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  init.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(input, { ...init, cache: "no-store", credentials: "same-origin", signal: controller.signal });
    return { response, failure: null };
  } catch {
    if (timedOut) return { response: null, failure: "timeout" };
    if (init.signal?.aborted) return { response: null, failure: "cancelled" };
    if (typeof navigator !== "undefined" && navigator.onLine === false) return { response: null, failure: "offline" };
    return { response: null, failure: "failed" };
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

/** The actions endpoint, read into a MenuLoad: status and shape checked, never text-matched (§12). */
export async function fetchMenu(pathname: string, signal: AbortSignal): Promise<MenuLoad> {
  const { response, failure } = await fetchWithDeadline(`/api/quick-create/actions?pathname=${encodeURIComponent(pathname)}`, { signal });
  if (failure === "cancelled") return { ok: false, reason: "cancelled" };
  if (failure) return { ok: false, reason: failure };
  if (!response) return { ok: false, reason: "failed" };
  if (response.status === 401) return { ok: false, reason: "unauthenticated" };
  if (!response.ok) return { ok: false, reason: "failed" };
  const body = (await response.json().catch(() => null)) as { data?: unknown } | null;
  if (signal.aborted) return { ok: false, reason: "cancelled" };
  return isMenuDTO(body?.data) ? { ok: true, menu: body.data } : { ok: false, reason: "failed" };
}

/** A same-origin application path the router may open — never another origin, a protocol-relative URL or an API route (QC-10). */
export function isInternalAppPath(href: unknown): href is string {
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//") || href.startsWith("/\\")) return false;
  try {
    const url = new URL(href, "https://nesto.invalid");
    return url.origin === "https://nesto.invalid" && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/admin");
  } catch {
    return false;
  }
}
