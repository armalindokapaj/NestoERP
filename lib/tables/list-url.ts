/**
 * List query-string transitions (AUD-08 §3, DT-05).
 *
 * The rules every list control follows, kept pure so they can be tested
 * without a browser:
 * - changing search, a filter, the section, the sort or the page size returns
 *   to page 1 — otherwise the reader lands on an empty page 3 of a shorter list;
 * - Clear filters removes only that list's own filter and search keys, keeping
 *   the section, the sort, the page size and every unrelated route key;
 * - a change that would produce the same query is no change at all, so an
 *   unchanged blur or a repeated submit does not start a second request.
 */

export type QueryChanges = Readonly<Record<string, string | null | undefined>>;

function params(query: string | URLSearchParams): URLSearchParams {
  if (query instanceof URLSearchParams) return new URLSearchParams(query.toString());
  return new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
}

/** Sets (non-empty) or removes (empty/null) each key, and returns to page 1. */
export function applyListChange(query: string | URLSearchParams, changes: QueryChanges, pageParam = "page"): string {
  const next = params(query);
  for (const [key, value] of Object.entries(changes)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  next.delete(pageParam);
  return next.toString();
}

/** Removes exactly `keys` (the list's filters and search) and the page; everything else stays. */
export function clearListFilters(query: string | URLSearchParams, keys: readonly string[], pageParam = "page"): string {
  const next = params(query);
  for (const key of keys) next.delete(key);
  next.delete(pageParam);
  return next.toString();
}

/** Whether two query strings say the same thing, whatever their key order. */
export function sameQuery(a: string | URLSearchParams, b: string | URLSearchParams): boolean {
  const left = params(a);
  const right = params(b);
  left.sort();
  right.sort();
  return left.toString() === right.toString();
}

/** A query string as a relative href: `?a=1`, or `?` for the bare path. */
export function queryHref(query: string): string {
  return query ? `?${query}` : "?";
}
