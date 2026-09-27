import { z } from "zod";

/**
 * Shared list-query handling (PRD #7 §29, PRD #8 §83–§86).
 *
 * Query values arrive from the browser and are never passed to Prisma raw: the
 * page is bounded, the limit has a ceiling the server enforces, and sorting is
 * restricted to an explicit map of safe keys (PRD #8 §86).
 */
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).catch(DEFAULT_LIMIT),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export function paginationMeta(total: number, page: number, limit: number) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page: Math.min(page, totalPages),
    limit,
    total,
    totalPages,
  };
}

export function skipFor(page: number, limit: number): number {
  return (page - 1) * limit;
}

/**
 * Case-insensitive "contains" search across a set of fields (PRD #8 §85).
 * Returns undefined when there is nothing to search for, so the caller can
 * spread it into a `where` without an empty OR.
 */
export function searchClause<T extends string>(
  term: string | undefined,
  fields: readonly T[],
): { OR: Record<string, { contains: string; mode: "insensitive" }>[] } | undefined {
  const trimmed = term?.trim();
  if (!trimmed) return undefined;

  return {
    OR: fields.map((field) => ({
      [field]: { contains: trimmed, mode: "insensitive" as const },
    })),
  };
}

/** Reads a single query-string value, ignoring repeats. */
export function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Turns a comma-separated query value into a validated enum list. */
export function enumList<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): T[] | undefined {
  const raw = firstValue(value);
  if (!raw) return undefined;

  const values = raw
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is T => (allowed as readonly string[]).includes(entry));

  return values.length > 0 ? values : undefined;
}

/* -------------------------------------------------------------------------- */
/* AUD-08 §4: one sort, one page window, one out-of-range rule                 */
/* -------------------------------------------------------------------------- */

type OrderEntry = Record<string, unknown>;

/**
 * Appends the unique tie-breaker every list and export sort needs (AUD-08 §4,
 * DT-04). Two rows with the same due date, amount or status would otherwise
 * come back in whatever order the plan happens to produce — different between
 * page 1 and page 2, and between the list and its export — so a row can repeat
 * or vanish across pages.
 *
 * Accepts any Prisma `orderBy` shape (one object, an array, or nothing) and
 * always returns an array ending in a unique key. When `idField` is already
 * ordered on — last or anywhere, it is unique, so everything after it is moot —
 * nothing is appended. An object with several keys is split into one entry per
 * key, in its own key order, which is how Prisma reads it.
 *
 * Null placement (the `nullsPlacement` guidance of the AUD-08 brief): a sort on
 * a nullable column states where nulls go, with Prisma's `{ sort, nulls }`
 * (see `sortNulls`), and the manifest records it per sort key. PostgreSQL's
 * default puts nulls last ascending and first descending; a list that relies on
 * that default says so in the manifest rather than leaving it implied.
 */
export function withTieBreaker<T extends OrderEntry>(
  orderBy: T | readonly T[] | undefined | null,
  idField = "id",
): T[] {
  const entries: T[] = [];
  const source = orderBy == null ? [] : Array.isArray(orderBy) ? (orderBy as readonly T[]) : [orderBy as T];
  for (const entry of source) {
    const keys = Object.keys(entry);
    if (keys.length <= 1) entries.push(entry);
    else for (const key of keys) entries.push({ [key]: entry[key] } as T);
  }
  if (entries.some((entry) => Object.prototype.hasOwnProperty.call(entry, idField))) return entries;
  entries.push({ [idField]: "asc" } as unknown as T);
  return entries;
}

/**
 * A nullable column's sort with its null placement said out loud (AUD-08 §4):
 * `{ dueDate: sortNulls("asc", "last") }`. Prisma supports `nulls` on optional
 * scalar fields only; a required field takes the plain direction.
 */
export function sortNulls(sort: "asc" | "desc", nulls: "first" | "last"): { sort: "asc" | "desc"; nulls: "first" | "last" } {
  return { sort, nulls };
}

export type PageWindow = {
  /** The page actually shown: the request clamped into 1..totalPages. */
  page: number;
  limit: number;
  /** Matching authorized records — never the loaded row count (AUD-08 §4). */
  total: number;
  /** At least 1, so "Page 1 of 1" reads for an empty list too. */
  totalPages: number;
  /** 1-based first row on the page; 0 when there are no rows. */
  from: number;
  /** 1-based last row on the page; 0 when there are no rows. */
  to: number;
  /** The request asked for a page past the last one while rows exist. */
  outOfRange: boolean;
};

/**
 * The page arithmetic one list response needs (AUD-08 §4, DT-05): "1–25 of 73",
 * "0 results" (0/0, never "1–0"), and whether the requested page is beyond the
 * end — after a delete, an archive or a narrower filter — so the page can move
 * to the last valid page once instead of showing an unexplained blank page.
 * Bad input (NaN, 0, negatives, fractions) is read as page 1 / limit 1 floor.
 */
export function pageWindow(total: number, page: number, limit: number): PageWindow {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const safeLimit = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1;
  const requested = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const totalPages = Math.max(1, Math.ceil(safeTotal / safeLimit));
  const current = Math.min(requested, totalPages);
  const outOfRange = safeTotal > 0 && requested > totalPages;
  if (safeTotal === 0) {
    return { page: 1, limit: safeLimit, total: 0, totalPages, from: 0, to: 0, outOfRange: false };
  }
  const from = (current - 1) * safeLimit + 1;
  const to = Math.min(current * safeLimit, safeTotal);
  return { page: current, limit: safeLimit, total: safeTotal, totalPages, from, to, outOfRange };
}

/** Next's `searchParams` object, a `URLSearchParams`, or a query string. */
export type SearchParamsInput =
  | URLSearchParams
  | string
  | Readonly<Record<string, string | readonly string[] | undefined>>;

function toSearchParams(input: SearchParamsInput): URLSearchParams {
  if (typeof input === "string") return new URLSearchParams(input.startsWith("?") ? input.slice(1) : input);
  if (input instanceof URLSearchParams) return new URLSearchParams(input.toString());
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (typeof value === "string") params.append(key, value);
    else for (const item of value) params.append(key, item);
  }
  return params;
}

/**
 * The URL of `page` of a list, keeping every other query key — search,
 * filters, section, sort, limit, workspace-owned keys, repeats — exactly as
 * they are (AUD-08 §3, §4). Page 1 is written without `page`, so page 1 has
 * one canonical address.
 */
export function pageHref(pathname: string, searchParams: SearchParamsInput, page: number, pageParam = "page"): string {
  const params = toSearchParams(searchParams);
  params.delete(pageParam);
  if (Number.isFinite(page) && page > 1) params.set(pageParam, String(Math.floor(page)));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Where a server page redirects when the requested page is past the end
 * (AUD-08 §4, DT-05): the last valid page, or page 1 when the list is empty,
 * with every other query key preserved. Call it only when `pageWindow(...)`
 * says `outOfRange`, and redirect once — the target is always in range, so
 * there is no loop:
 *
 *   const window = pageWindow(total, query.page, query.limit);
 *   if (window.outOfRange) redirect(listPageRedirect(path, searchParams, window.totalPages));
 */
export function listPageRedirect(
  pathname: string,
  searchParams: SearchParamsInput,
  lastPage: number,
  pageParam = "page",
): string {
  const target = Number.isFinite(lastPage) && lastPage > 1 ? Math.floor(lastPage) : 1;
  return pageHref(pathname, searchParams, target, pageParam);
}
