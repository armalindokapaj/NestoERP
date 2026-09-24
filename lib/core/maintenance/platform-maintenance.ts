import { deleteCached, getCached, platformCacheKey, setCached } from "@/lib/core/cache/cache.service";
import { logger } from "@/lib/core/observability/logger";
import { incrementCounter, Metric, recordDuration } from "@/lib/core/observability/metrics";
import { scoped } from "@/lib/core/observability/request-scope";
import { prisma } from "@/lib/database/prisma";

/**
 * Platform maintenance state (NAV-02 §11, §12).
 *
 * Two ways to ask, for two different jobs:
 *
 * - `getMaintenanceState` — the enforcement read. Tenant APIs, sign-in, uploads,
 *   3D processing and the Platform Admin's own screens ask the database on
 *   every request (shared only within that request), so a change is enforced
 *   on the very next one.
 * - `getPageMaintenanceState` + `admitPage` — page rendering. A tenant page may
 *   reuse a snapshot for at most five seconds, measured from the start of the
 *   read that produced it, on this process only. An enabled snapshot is
 *   confirmed live before anyone is redirected, so a stale one cannot bounce a
 *   page to /maintenance and back.
 *
 * A read that fails is never "maintenance off": it is an error, and the caller
 * fails closed (§13).
 */

export type MaintenanceState = {
  enabled: boolean;
  readOnly: boolean;
  disableUploads: boolean;
  disableNewLogins: boolean;
  disable3DProcessing: boolean;
  reason: string | null;
};

type Flag = Exclude<keyof MaintenanceState, "reason">;

/** Reason precedence (MAINT-02): the whole platform first, then the narrower switches. */
const FLAGS: ReadonlyArray<readonly [Flag, string]> = [
  ["enabled", "maintenance.enabled"],
  ["readOnly", "maintenance.readOnly"],
  ["disableUploads", "maintenance.disableUploads"],
  ["disableNewLogins", "maintenance.disableNewLogins"],
  ["disable3DProcessing", "maintenance.disable3DProcessing"],
];
const FLAG_BY_KEY = new Map(FLAGS.map(([flag, key]) => [key, flag]));

/** A known setting holds something other than a boolean: a configuration fault, never "off". */
export class MaintenanceConfigurationError extends Error {
  constructor(readonly key: string) {
    super(`Maintenance setting ${key} is not a boolean.`);
    this.name = "MaintenanceConfigurationError";
  }
}

/**
 * The authoritative read. Missing rows are the documented default, false
 * (MAINT-02); a failed query or a malformed value throws.
 */
export async function readMaintenanceState(): Promise<MaintenanceState> {
  const startedAt = performance.now();
  let rows: Array<{ key: string; value: unknown; reason: string | null }>;
  try {
    rows = await prisma.platformSetting.findMany({
      where: { key: { in: FLAGS.map(([, key]) => key) } },
      select: { key: true, value: true, reason: true },
    });
  } catch (error) {
    incrementCounter(Metric.MAINTENANCE_READ_FAILURE, { kind: "database" });
    throw error;
  }

  const state: MaintenanceState = { enabled: false, readOnly: false, disableUploads: false, disableNewLogins: false, disable3DProcessing: false, reason: null };
  const reasons = new Map<Flag, string | null>();
  for (const row of rows) {
    const flag = FLAG_BY_KEY.get(row.key);
    if (!flag) continue;
    if (typeof row.value !== "boolean") {
      incrementCounter(Metric.MAINTENANCE_READ_FAILURE, { kind: "configuration" });
      throw new MaintenanceConfigurationError(row.key);
    }
    state[flag] = row.value;
    reasons.set(flag, row.reason);
  }
  const first = FLAGS.find(([flag]) => state[flag]);
  state.reason = first ? (reasons.get(first[0]) ?? null) : null;
  recordDuration(Metric.MAINTENANCE_DECISION_MS, Metric.MAINTENANCE_DECISION, startedAt, { path: "read" });
  return state;
}

/* -------------------------------------------------------------------------- */
/* Enforcement                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The enforcement read (MAINT-01): the database, once per request. Never a
 * snapshot from an earlier request, and never another request's in-flight
 * read. A valid result also refreshes this process's page snapshot.
 */
export function getMaintenanceState(): Promise<MaintenanceState> {
  return scoped("maintenance:fresh", async () => {
    const readStartedAt = performance.now();
    const generationAtStart = shared.generation;
    const state = await readMaintenanceState();
    rememberSnapshot({ state, readStartedAt, generation: generationAtStart });
    return state;
  });
}

/* -------------------------------------------------------------------------- */
/* Page snapshot                                                               */
/* -------------------------------------------------------------------------- */

/** Hard maximum age of a page snapshot, from the start of its read (CACHE-01). */
export const PAGE_SNAPSHOT_MAX_AGE_MS = 5_000;

type Snapshot = { state: MaintenanceState; readStartedAt: number; generation: number };

/** What page rendering is handed: the state and when its read began. */
export type PageMaintenanceCandidate = { state: MaintenanceState; readStartedAt: number; source: "snapshot" | "read" | "bypass" };

const SNAPSHOT_KEY = platformCacheKey("platform-maintenance", "page");

/**
 * This process's snapshot bookkeeping. On `globalThis`, because a server
 * bundle loads this module once for its pages and again for its route
 * handlers: a Platform Admin's save, handled in one copy, must reach the
 * snapshot pages read in the other.
 */
type SnapshotState = { generation: number; inflight: { generation: number; promise: Promise<Snapshot> } | null };
const processState = globalThis as unknown as { __nestoMaintenanceSnapshot?: SnapshotState };
const shared = (processState.__nestoMaintenanceSnapshot ??= { generation: 0, inflight: null });

/** The operational switch (§20): off means every page reads fresh, which is always safe. */
function snapshotsDisabled(): boolean {
  return process.env.NESTO_MAINTENANCE_PAGE_CACHE === "off";
}

function ageOf(readStartedAt: number): number {
  return performance.now() - readStartedAt;
}

export function isSnapshotFresh(candidate: { readStartedAt: number }): boolean {
  return ageOf(candidate.readStartedAt) <= PAGE_SNAPSHOT_MAX_AGE_MS;
}

function readSnapshot(): Snapshot | null {
  try {
    const snapshot = getCached<Snapshot>(SNAPSHOT_KEY);
    if (!snapshot || snapshot.generation !== shared.generation) return null;
    return snapshot;
  } catch (error) {
    // A cache that cannot answer is a miss, never a stale answer (M17).
    logger.warn("maintenance.page_cache.read_failed", { errorMessage: error instanceof Error ? error.message : "unknown" });
    return null;
  }
}

/** Keeps a valid result for the rest of its five seconds — never a fresh five for a late read (M16). */
function rememberSnapshot(snapshot: Snapshot): void {
  if (snapshotsDisabled() || snapshot.generation !== shared.generation) return;
  const remainingMs = PAGE_SNAPSHOT_MAX_AGE_MS - ageOf(snapshot.readStartedAt);
  if (remainingMs <= 0) return;
  try {
    setCached(SNAPSHOT_KEY, snapshot, remainingMs / 1000);
  } catch (error) {
    // The decision in hand stays valid; the next request reads again.
    logger.warn("maintenance.page_cache.write_failed", { errorMessage: error instanceof Error ? error.message : "unknown" });
  }
}

/** One read per generation on this process; later callers join it (M04). */
function loadSnapshot(): Promise<Snapshot> {
  const generationAtStart = shared.generation;
  if (shared.inflight && shared.inflight.generation === generationAtStart) {
    incrementCounter(Metric.MAINTENANCE_PAGE_CACHE, { outcome: "coalesced" });
    return shared.inflight.promise;
  }
  const readStartedAt = performance.now();
  const promise = readMaintenanceState().then(async (state): Promise<Snapshot> => {
    // A committed change landed while this read was running: its answer may
    // predate the change, so it neither fills the cache nor admits anyone (M05).
    if (generationAtStart !== shared.generation) {
      incrementCounter(Metric.MAINTENANCE_PAGE_CACHE, { outcome: "discarded" });
      const retryStartedAt = performance.now();
      const retryGeneration = shared.generation;
      const retry = { state: await readMaintenanceState(), readStartedAt: retryStartedAt, generation: retryGeneration };
      rememberSnapshot(retry);
      return retry;
    }
    const snapshot = { state, readStartedAt, generation: generationAtStart };
    rememberSnapshot(snapshot);
    return snapshot;
  });
  const entry = { generation: generationAtStart, promise };
  shared.inflight = entry;
  promise.then(
    () => undefined,
    () => undefined,
  ).finally(() => {
    if (shared.inflight === entry) shared.inflight = null;
  });
  return promise;
}

/**
 * The page candidate: a snapshot younger than five seconds, or a fresh read.
 * An expired snapshot is never served while a new one loads (M02).
 */
export async function getPageMaintenanceState(): Promise<PageMaintenanceCandidate> {
  if (snapshotsDisabled()) {
    const readStartedAt = performance.now();
    return { state: await readMaintenanceState(), readStartedAt, source: "bypass" };
  }
  const snapshot = readSnapshot();
  if (snapshot && isSnapshotFresh(snapshot)) {
    incrementCounter(Metric.MAINTENANCE_PAGE_CACHE, { outcome: "hit" });
    return { state: snapshot.state, readStartedAt: snapshot.readStartedAt, source: "snapshot" };
  }
  incrementCounter(Metric.MAINTENANCE_PAGE_CACHE, { outcome: snapshot ? "expired" : "miss" });
  const loaded = await loadSnapshot();
  return { state: loaded.state, readStartedAt: loaded.readStartedAt, source: "read" };
}

/**
 * The decision a page is admitted on (M03, CACHE-04). The candidate may have
 * been started beside a slower authentication; its age is checked again here,
 * at the moment of use. An "enabled" answer from a snapshot is confirmed live
 * before anybody is sent to /maintenance.
 */
export async function admitPage(candidate: Promise<PageMaintenanceCandidate>): Promise<MaintenanceState> {
  let current = await candidate;
  if (!isSnapshotFresh(current)) {
    incrementCounter(Metric.MAINTENANCE_PAGE_CACHE, { outcome: "expired_at_admission" });
    current = await getPageMaintenanceState();
  }
  if (current.state.enabled && current.source === "snapshot") return getMaintenanceState();
  return current.state;
}

/**
 * After a committed maintenance write (CACHE-02, CACHE-03): forget this
 * process's snapshot and move to a new generation, so a read still in flight
 * cannot put the old answer back. Other instances are not reached; their
 * snapshots expire within five seconds on their own.
 */
export function invalidateMaintenanceSnapshot(): void {
  shared.generation += 1;
  shared.inflight = null;
  deleteCached(SNAPSHOT_KEY);
}

/** Test seam: an empty process, as after a restart (M17). */
export function resetMaintenanceSnapshotForTests(): void {
  shared.generation += 1;
  shared.inflight = null;
  try {
    deleteCached(SNAPSHOT_KEY);
  } catch {
    // nothing to forget
  }
}
