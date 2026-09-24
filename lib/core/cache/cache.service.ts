import { logger } from "@/lib/core/observability/logger";

/**
 * Caching (PRD #31 §88-§115, §218-§225).
 *
 * The rule that matters more than the speed: a cache must never become a
 * permission source. Every key for personalised data carries an access
 * signature, so a role change produces a different key rather than a stale
 * answer (PRD #31 §95, §96, §237, §419).
 *
 * In-process by design for V0.1. The moment NESTO runs more than one instance,
 * this is the seam where Redis goes (PRD #31 §92, §302).
 */

type Entry = { value: unknown; expiresAt: number };

// One store per process, however many times a server bundle loads this module
// (pages and route handlers each get their own copy); otherwise a write from
// one never reaches a read in the other (NAV-02 CACHE-01).
const processCache = globalThis as unknown as { __nestoCacheStore?: Map<string, Entry> };
const store = (processCache.__nestoCacheStore ??= new Map<string, Entry>());
const MAX_ENTRIES = 5000;

export type CacheNamespace =
  | "company-config"
  | "permissions"
  | "reports"
  | "lookups"
  | "search-static"
  | "notifications-count";

/** `v1:{namespace}:{companyId}:{discriminator}` (PRD #31 §223, §224). */
export function cacheKey(
  namespace: CacheNamespace,
  companyId: string,
  ...parts: Array<string | number>
): string {
  return ["v1", namespace, companyId, ...parts.map(String)].join(":");
}

/**
 * A compact stand-in for "who is asking", so one member's cached report can
 * never be served to another (PRD #31 §96, §97, §213 of #27).
 */
export function accessSignature(context: {
  membershipId: string;
  accessVersion?: number;
  configVersion?: number;
}): string {
  return [context.membershipId, context.accessVersion ?? 0, context.configVersion ?? 0].join(".");
}

function evictIfNeeded(): void {
  if (store.size < MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  // Still full: drop the oldest insertions rather than grow without bound.
  if (store.size >= MAX_ENTRIES) {
    let toDrop = Math.ceil(MAX_ENTRIES * 0.1);
    for (const key of store.keys()) {
      store.delete(key);
      if (--toDrop <= 0) break;
    }
  }
}

export function getCached<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCached<T>(key: string, value: T, ttlSeconds: number): void {
  evictIfNeeded();
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function deleteCached(key: string): void {
  store.delete(key);
}

/** Invalidates a whole namespace for one company (PRD #31 §102, §106). */
export function invalidateNamespace(namespace: CacheNamespace, companyId: string): number {
  const prefix = `v1:${namespace}:${companyId}:`;
  let removed = 0;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Reads through the cache, falling back to the source on any failure.
 *
 * Cache is an optimisation, never an authority: if anything goes wrong the
 * authoritative query runs (PRD #31 §94, §230-§235).
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  try {
    const hit = getCached<T>(key);
    if (hit !== null) return hit;
  } catch (error) {
    logger.warn("cache.read.failed", { errorMessage: error instanceof Error ? error.message : "unknown" });
  }

  const value = await load();

  try {
    setCached(key, value, ttlSeconds);
  } catch (error) {
    logger.warn("cache.write.failed", { errorMessage: error instanceof Error ? error.message : "unknown" });
  }

  return value;
}

/** Test seam. */
export function clearCache(): void {
  store.clear();
}
