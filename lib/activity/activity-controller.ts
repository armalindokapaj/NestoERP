import type { ActivityCounts, ActivityPage, ActivityType } from "@/lib/modules/activity/activity-center.service";

/**
 * The one owner of the bell's reads in a tab (NAV-03 §9, ACTIVITY-01..06).
 *
 * Views subscribe to it; none of them keeps a timer of its own. There is one
 * next-due timeout, reads join per resource, and nothing new starts while the
 * tab is hidden or offline:
 *
 * - closed and healthy: the count every 120 s after the last success;
 * - open, or a known critical/attention count: every 45 s, and the selected
 *   first page with it;
 * - focus, visibility and online in one burst: one resume, 250 ms later, which
 *   reads only what is dirty, missing, failed or at least 30 s old;
 * - a read, seen or acknowledge change: one reconciliation within a second,
 *   at most one start per second, and a trailing one for a sustained burst;
 * - failures back off 15, 30, 60, then 120 s, or a longer Retry-After.
 *
 * Every answer is checked against the generation, the context key and the
 * mutation epoch it was asked under before it may publish (RUNTIME-03). The
 * count is unknown until the first success, never a made-up zero.
 */

export const CLOSED_INTERVAL_MS = 120_000;
export const OPEN_INTERVAL_MS = 45_000;
export const INITIAL_DELAY_MS = 2_000;
export const RESUME_COALESCE_MS = 250;
export const RESUME_STALE_MS = 30_000;
export const OPEN_COUNT_STALE_MS = 15_000;
export const LIST_TTL_MS = 30_000;
export const READ_DEADLINE_MS = 8_000;
export const RECONCILE_BATCH_MS = 250;
export const RECONCILE_MIN_GAP_MS = 1_000;
export const LIST_CACHE_BYTES = 256 * 1024;
export const BACKOFF_MS = [15_000, 30_000, 60_000, 120_000] as const;
export const PANEL_LIMIT = 10;

export type ReadResult<T> =
  | { ok: true; data: T; contextKey?: string }
  | { ok: false; status: number; retryAfterMs?: number; offline?: boolean };

export type ActivityTransport = {
  count(signal: AbortSignal): Promise<ReadResult<ActivityCounts>>;
  list(type: ActivityType, signal: AbortSignal): Promise<ReadResult<ActivityPage>>;
};

export type ActivityEnvironment = {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  visible(): boolean;
  online(): boolean;
  /** Up to 10 % earlier, never later (ACTIVITY-02). */
  jitter(): number;
};

export type CountState = { value: ActivityCounts | null; stale: boolean; failed: boolean };
export type ListState = { type: ActivityType; page: ActivityPage | null; loading: boolean; failed: boolean; stale: boolean };
export type ActivitySnapshot = { open: boolean; count: CountState; list: ListState; suspended: boolean };

export type ActivityControllerOptions = {
  contextKey: string;
  transport: ActivityTransport;
  environment?: ActivityEnvironment;
  /** Called once when a read answers 401: the existing sign-in recovery. */
  onUnauthenticated?: () => void;
  /** Called once per context when an answer belongs to another context or access changed. */
  onContextMismatch?: () => void;
};

type Snapshot<T> = { data: T; at: number; bytes: number };

export const browserEnvironment: ActivityEnvironment = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
  visible: () => typeof document === "undefined" || document.visibilityState === "visible",
  online: () => typeof navigator === "undefined" || navigator.onLine !== false,
  jitter: () => Math.random() * 0.1,
};

export function createActivityController(options: ActivityControllerOptions) {
  const env = options.environment ?? browserEnvironment;
  const listeners = new Set<() => void>();

  let disposed = false;
  let open = false;
  let tab: ActivityType = "ALL";
  let suspended = false;
  let mismatchReported = false;
  /** Bumped by every mutation start: a read asked before it may not publish (ACTIVITY-05). */
  let epoch = 0;

  let count: Snapshot<ActivityCounts> | null = null;
  let countFailed = false;
  let countStale = false;
  let countDirty = false;
  let countFailures = 0;
  let countBlockedUntil = 0;
  let countFlight: { promise: Promise<void>; epoch: number; controller: AbortController } | null = null;
  let followUpCount = false;

  const lists = new Map<ActivityType, Snapshot<ActivityPage>>();
  const listDirty = new Set<ActivityType>();
  let listFlight: { type: ActivityType; promise: Promise<void>; epoch: number; controller: AbortController } | null = null;
  let listLoading = false;
  let listFailed = false;
  let listStale = false;
  let listFailures = 0;
  let listBlockedUntil = 0;

  let due: unknown = null;
  let initial: unknown = null;
  let resume: unknown = null;
  let reconcile: unknown = null;
  let lastReconcile = -Infinity;
  let started = false;

  let snapshot: ActivitySnapshot = build();

  function build(): ActivitySnapshot {
    const page = lists.get(tab);
    return {
      open,
      suspended,
      count: { value: count?.data ?? null, stale: countStale, failed: countFailed },
      list: { type: tab, page: page?.data ?? null, loading: listLoading, failed: listFailed, stale: listStale },
    };
  }

  function emit() {
    snapshot = build();
    for (const listener of listeners) listener();
  }

  const live = () => !disposed && !suspended;
  const active = () => live() && env.visible() && env.online();

  function critical(): boolean {
    const value = count?.data;
    return Boolean(value && value.critical + value.attention > 0);
  }

  function interval(): number {
    const base = open || critical() ? OPEN_INTERVAL_MS : CLOSED_INTERVAL_MS;
    return Math.round(base * (1 - Math.min(0.1, Math.max(0, env.jitter()))));
  }

  function backoff(failures: number, retryAfterMs?: number): number {
    const step = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[0];
    return Math.max(step, retryAfterMs ?? 0);
  }

  /** The single next-due timeout: the next periodic tick, or a backoff retry. */
  function schedule() {
    if (due !== null) env.clearTimeout(due);
    due = null;
    if (!live() || !started) return;
    const now = env.now();
    // A resource with a read in flight is rescheduled by that read's completion.
    let at = Infinity;
    if (!countFlight) {
      at = count ? count.at + interval() : now;
      at = countFailed ? Math.max(countBlockedUntil, now) : Math.max(at, countBlockedUntil);
    }
    if (open && !listFlight) {
      const page = lists.get(tab);
      const listAt = listFailed ? Math.max(listBlockedUntil, now) : page ? Math.max(page.at + OPEN_INTERVAL_MS, listBlockedUntil) : now;
      at = Math.min(at, listAt);
    }
    if (at === Infinity) return;
    due = env.setTimeout(tick, Math.max(0, at - now));
  }

  function tick() {
    due = null;
    if (!active()) {
      // Hidden or offline: remember, fetch nothing, catch up on resume (ACTIVITY-02).
      countDirty = true;
      if (open) listDirty.add(tab);
      return;
    }
    const now = env.now();
    const countDue = !count || countFailed || now >= count.at + interval() - 5;
    if (countDue && now >= countBlockedUntil) void readCount();
    if (open) {
      const page = lists.get(tab);
      const listDue = !page || listFailed || now >= page.at + OPEN_INTERVAL_MS - 5;
      if (listDue && now >= listBlockedUntil) void readList(tab);
    }
    schedule();
  }

  function withDeadline(controller: AbortController) {
    const timer = env.setTimeout(() => controller.abort(), READ_DEADLINE_MS);
    return () => env.clearTimeout(timer);
  }

  function checkContext(result: { contextKey?: string }): boolean {
    if (!result.contextKey || result.contextKey === options.contextKey) return true;
    contextLost();
    return false;
  }

  function contextLost() {
    count = null;
    lists.clear();
    countStale = listStale = false;
    if (!mismatchReported) {
      mismatchReported = true;
      options.onContextMismatch?.();
    }
    suspend();
  }

  function unauthenticated() {
    count = null;
    lists.clear();
    suspend();
    options.onUnauthenticated?.();
  }

  function suspend() {
    suspended = true;
    if (due !== null) env.clearTimeout(due);
    due = null;
    countFlight?.controller.abort();
    listFlight?.controller.abort();
    emit();
  }

  function readCount(): Promise<void> {
    if (!live()) return Promise.resolve();
    if (countFlight) {
      // A read that predates a mutation cannot answer for it: one follow-up after it.
      if (countFlight.epoch !== epoch) followUpCount = true;
      return countFlight.promise;
    }
    const asked = epoch;
    const controller = new AbortController();
    const release = withDeadline(controller);
    const promise = options.transport
      .count(controller.signal)
      .catch((): ReadResult<ActivityCounts> => ({ ok: false, status: 0, offline: !env.online() }))
      .then((result) => {
        release();
        if (disposed || countFlight?.promise !== promise) return;
        countFlight = null;
        if (asked !== epoch) {
          // Overtaken by a mutation: never the authoritative answer (A11).
          followUpCount = true;
        } else if (result.ok) {
          if (!checkContext(result)) return;
          count = { data: result.data, at: env.now(), bytes: 0 };
          countFailed = countStale = countDirty = false;
          countFailures = 0;
          countBlockedUntil = 0;
        } else if (result.status === 401) {
          return unauthenticated();
        } else if (result.status === 403) {
          return contextLost();
        } else {
          countFailed = true;
          countStale = count !== null;
          countFailures += 1;
          countBlockedUntil = env.now() + (result.offline ? 0 : backoff(countFailures, result.retryAfterMs));
          if (result.offline) countDirty = true;
        }
        emit();
        if (followUpCount) {
          followUpCount = false;
          if (active()) void readCount();
          else countDirty = true;
        }
        schedule();
      });
    countFlight = { promise, epoch: asked, controller };
    return promise;
  }

  function cacheList(type: ActivityType, page: ActivityPage) {
    const bytes = JSON.stringify(page).length * 2;
    lists.delete(type);
    if (bytes > LIST_CACHE_BYTES) {
      // Too large to keep; shown while selected, never truncated (A16).
      lists.set(type, { data: page, at: env.now(), bytes: 0 });
      return;
    }
    lists.set(type, { data: page, at: env.now(), bytes });
    let total = 0;
    for (const entry of lists.values()) total += entry.bytes;
    for (const [key, entry] of lists) {
      if (total <= LIST_CACHE_BYTES || lists.size <= 1) break;
      if (key === type) continue;
      total -= entry.bytes;
      lists.delete(key);
    }
  }

  function readList(type: ActivityType): Promise<void> {
    if (!live()) return Promise.resolve();
    if (listFlight && listFlight.type === type && listFlight.epoch === epoch) return listFlight.promise;
    // A read for another tab, or from before a mutation, is detached (A05).
    listFlight?.controller.abort();
    const asked = epoch;
    const controller = new AbortController();
    const release = withDeadline(controller);
    listLoading = true;
    if (type === tab) emit();
    const promise = options.transport
      .list(type, controller.signal)
      .catch((): ReadResult<ActivityPage> => ({ ok: false, status: 0, offline: !env.online() }))
      .then((result) => {
        release();
        if (disposed || listFlight?.promise !== promise) return;
        listFlight = null;
        listLoading = false;
        if (asked !== epoch) {
          listDirty.add(type);
        } else if (result.ok) {
          if (!checkContext(result)) return;
          cacheList(type, result.data);
          listDirty.delete(type);
          listFailed = listStale = false;
          listFailures = 0;
          listBlockedUntil = 0;
        } else if (result.status === 401) {
          return unauthenticated();
        } else if (result.status === 403) {
          return contextLost();
        } else if (type === tab) {
          listFailed = true;
          listStale = lists.has(type);
          listFailures += 1;
          listBlockedUntil = env.now() + (result.offline ? 0 : backoff(listFailures, result.retryAfterMs));
        }
        emit();
        if (open && listDirty.has(tab) && active()) void readList(tab);
        schedule();
      });
    listFlight = { type, promise, epoch: asked, controller };
    return promise;
  }

  function listUsable(type: ActivityType): boolean {
    const page = lists.get(type);
    return Boolean(page && !listDirty.has(type) && env.now() - page.at < LIST_TTL_MS);
  }

  function onResume() {
    if (!live()) return;
    if (resume !== null) env.clearTimeout(resume);
    resume = env.setTimeout(() => {
      resume = null;
      if (!active()) return;
      const now = env.now();
      if (countDirty || !count || countFailed || now - count.at >= RESUME_STALE_MS) {
        if (now >= countBlockedUntil) void readCount();
      }
      if (open && !listUsable(tab)) void readList(tab);
      schedule();
    }, RESUME_COALESCE_MS);
  }

  function reconcileSoon() {
    countDirty = true;
    for (const type of ["ALL", "NOTIFICATION", "ANNOUNCEMENT"] as ActivityType[]) listDirty.add(type);
    if (!live()) return;
    if (reconcile !== null) return;
    const wait = Math.max(RECONCILE_BATCH_MS, lastReconcile + RECONCILE_MIN_GAP_MS - env.now());
    reconcile = env.setTimeout(() => {
      reconcile = null;
      if (!active()) return;
      lastReconcile = env.now();
      void readCount();
      if (open) void readList(tab);
    }, wait);
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,

    /** Starts the count after the page's core is ready, or two seconds at most (ACTIVITY-02). */
    start({ coreReady = false }: { coreReady?: boolean } = {}) {
      if (started || disposed) return;
      const begin = () => {
        if (initial !== null) env.clearTimeout(initial);
        initial = null;
        if (started) return;
        started = true;
        if (active()) void readCount();
        else countDirty = true;
        schedule();
      };
      if (coreReady) begin();
      else initial = env.setTimeout(begin, INITIAL_DELAY_MS);
    },

    setOpen(next: boolean) {
      if (next === open) return;
      open = next;
      if (open) {
        // Opening overtakes the initial delay, and reads what is missing or old.
        if (!started) {
          if (initial !== null) env.clearTimeout(initial);
          initial = null;
          started = true;
        }
        if (active()) {
          if (!count || countFailed || countDirty || env.now() - count.at >= OPEN_COUNT_STALE_MS) void readCount();
          if (!listUsable(tab)) void readList(tab);
        }
      } else {
        listLoading = false;
      }
      emit();
      schedule();
    },

    selectTab(next: ActivityType) {
      if (next === tab) return;
      tab = next;
      listFailed = false;
      listStale = false;
      listLoading = false;
      emit();
      if (open && active() && !listUsable(tab)) void readList(tab);
      schedule();
    },

    /** Explicit Retry in the panel: at once, except during a server cooldown. */
    retry() {
      if (!live()) return;
      if (env.now() >= countBlockedUntil || countFailed) void readCount();
      if (open) void readList(tab);
    },

    /** focus, visibilitychange to visible, online. */
    resume: onResume,

    /** A mutation is about to be sent: older reads may no longer publish. */
    beginMutation() {
      epoch += 1;
      return epoch;
    },

    /** A read, seen or acknowledge change finished here or in another tab. */
    changed: reconcileSoon,

    /** Local optimistic edits to the selected page, never re-ordered by older reads. */
    patchList(update: (page: ActivityPage) => ActivityPage) {
      const page = lists.get(tab);
      if (!page) return;
      lists.set(tab, { ...page, data: update(page.data) });
      emit();
    },

    patchCount(update: (counts: ActivityCounts) => ActivityCounts) {
      if (!count) return;
      count = { ...count, data: update(count.data) };
      emit();
    },

    /** Pauses every timer and read; start() resumes. Strict Mode and unmounts use this. */
    stop() {
      started = false;
      for (const handle of [due, initial, resume, reconcile]) if (handle !== null) env.clearTimeout(handle);
      due = initial = resume = reconcile = null;
      countFlight?.controller.abort();
      listFlight?.controller.abort();
      countFlight = null;
      listFlight = null;
      listLoading = false;
    },

    /** Sign-out or a user switch: forget every payload at once (ACTIVITY-04). */
    reset() {
      count = null;
      lists.clear();
      countFailed = countStale = listFailed = listStale = false;
      countDirty = true;
      emit();
    },

    dispose() {
      disposed = true;
      for (const handle of [due, initial, resume, reconcile]) if (handle !== null) env.clearTimeout(handle);
      countFlight?.controller.abort();
      listFlight?.controller.abort();
      lists.clear();
      count = null;
      listeners.clear();
    },
  };
}

export type ActivityController = ReturnType<typeof createActivityController>;

/** The transport over the Activity Center APIs, with an 8 s deadline supplied by the controller. */
export function fetchTransport(limit = PANEL_LIMIT): ActivityTransport {
  async function read<T>(url: string, signal: AbortSignal): Promise<ReadResult<T>> {
    let response: Response;
    try {
      response = await fetch(url, { signal, cache: "no-store", headers: { accept: "application/json" } });
    } catch {
      return { ok: false, status: 0, offline: typeof navigator !== "undefined" && navigator.onLine === false };
    }
    if (!response.ok) {
      const retry = Number(response.headers.get("retry-after"));
      return { ok: false, status: response.status, retryAfterMs: Number.isFinite(retry) && retry > 0 ? retry * 1000 : undefined };
    }
    const body = (await response.json()) as { data: T; meta?: { contextKey?: string } };
    return { ok: true, data: body.data, contextKey: body.meta?.contextKey };
  }
  return {
    count: (signal) => read<ActivityCounts>("/api/activity-center/unread-count", signal),
    list: (type, signal) => read<ActivityPage>(`/api/activity-center?type=${type}&limit=${limit}`, signal),
  };
}
