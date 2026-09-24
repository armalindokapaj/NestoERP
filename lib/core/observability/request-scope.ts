import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";

import { incrementCounter, Metric } from "@/lib/core/observability/metrics";

/**
 * One request's reusable reads (NAV-02 CTX-01, CTX-02).
 *
 * A request asks the same questions many times — the session, the person's
 * organization access, a company's modules, their contexts across the group —
 * from the layout, the shell, the page and the services under them. The scope
 * answers each once: the first caller's promise is kept before it is awaited,
 * so concurrent callers join the same work, and every later caller gets the
 * same immutable result. A failure is shared too, for this request only, so a
 * dozen consumers of one failed read do not become a dozen retries.
 *
 * It is a snapshot of one request, never a cache across requests: the next
 * request resolves the session, memberships and grants again, so revoking
 * access still takes effect at once (CTX-01, CACHE-05). Nothing here is
 * serialised to a browser.
 *
 * Where the scope comes from (CTX-02):
 * - route handlers, platform handlers and job attempts run inside
 *   `runWithRequestScope` (AsyncLocalStorage), set by `withContext`,
 *   `withPlatformContext` and the job runner;
 * - a server render uses one per-render scope from React's `cache`, which
 *   Next.js scopes to the request;
 * - anywhere else — a direct service call, a test — there is no scope, and
 *   every read is a fresh, authoritative one.
 *
 * Keys carry every primitive the answer depends on: organization access is
 * per parent group and user, modules per company. A new object with the same
 * fields is not the same key, which is why the keys are strings.
 */

export type RequestScope = {
  readonly id: number;
  readonly memo: Map<string, Promise<unknown>>;
};

let nextScopeId = 1;

export function createRequestScope(): RequestScope {
  return { id: nextScopeId++, memo: new Map() };
}

// One per process, shared by every copy of this module a server bundle loads.
const processScope = globalThis as unknown as { __nestoRequestScope?: AsyncLocalStorage<RequestScope> };
const storage = (processScope.__nestoRequestScope ??= new AsyncLocalStorage<RequestScope>());

/** Runs `fn` with its own scope: one route handler request, one server action, one job attempt. */
export function runWithRequestScope<T>(fn: () => T, scope: RequestScope = createRequestScope()): T {
  return storage.run(scope, fn);
}

/** The render's scope. React's `cache` gives each server render its own; outside a render it memoizes nothing. */
const renderScope = cache((): RequestScope => createRequestScope());

export function currentRequestScope(): RequestScope | null {
  const bound = storage.getStore();
  if (bound) return bound;
  // Outside a render, `cache` calls through, so two calls give two scopes.
  // Only a live render hands the same one back.
  const first = renderScope();
  return first === renderScope() ? first : null;
}

/**
 * The request's answer to `key`, loading it once. Without a scope it simply
 * loads: an uncached, authoritative read is always a correct answer.
 */
export function scoped<T>(key: string, load: () => Promise<T>): Promise<T> {
  const scope = currentRequestScope();
  if (!scope) return load();
  const existing = scope.memo.get(key);
  if (existing) {
    incrementCounter(Metric.REQUEST_SCOPE_REUSE, { family: familyOf(key) });
    return existing as Promise<T>;
  }
  const promise = load();
  // Kept before it settles, so a concurrent caller joins it. A rejection is
  // observed here so it is never reported as unhandled while it waits for them.
  promise.catch(() => undefined);
  scope.memo.set(key, promise);
  return promise;
}

/** A value this request already has or is loading, without starting a load. */
export function peekScoped<T>(key: string): Promise<T> | undefined {
  return currentRequestScope()?.memo.get(key) as Promise<T> | undefined;
}

/** Records a value the request has learnt another way, so the next reader need not load it. */
export function seedScoped<T>(key: string, value: T): void {
  const scope = currentRequestScope();
  if (scope && !scope.memo.has(key)) scope.memo.set(key, Promise.resolve(value));
}

/**
 * Forgets what this request has read (CTX-04). Called after a commit that
 * changes the answers — a workspace switch, a membership move, access or module
 * changes — so code later in the same request reads the new state rather than
 * the snapshot from before it. Without a prefix it forgets everything.
 */
export function invalidateRequestScope(prefix?: string): void {
  const scope = currentRequestScope();
  if (!scope) return;
  if (prefix === undefined) {
    scope.memo.clear();
    return;
  }
  for (const key of [...scope.memo.keys()]) if (key.startsWith(prefix)) scope.memo.delete(key);
}

/** `invalidateRequestScope` once `committed` has succeeded: for writers that return their transaction. */
export async function invalidatingRequestScope<T>(committed: Promise<T>): Promise<T> {
  const result = await committed;
  invalidateRequestScope();
  return result;
}

/** The key's family, a low-cardinality metric label: `org:group:user` → `org`. */
function familyOf(key: string): string {
  const family = key.split(":", 1)[0];
  return KNOWN_FAMILIES.has(family) ? family : "other";
}

const KNOWN_FAMILIES = new Set(["user-context", "org", "modules", "group-contexts", "productivity-settings", "maintenance"]);
