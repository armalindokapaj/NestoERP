import type * as React from "react";

/**
 * The shared shape of a list's query (MOB-03 §85, §84).
 *
 * The URL query string is the canonical query state of every NESTO list; these
 * types and pure helpers are the typed view of it, so desktop and phone
 * presentations, the filter sheet, chips, saved views and tests all speak one
 * language. Nothing here decides what a person may see: the server's parsers
 * and authorization stay authoritative. Edge-safe, no React.
 */

/** One applied filter: the URL param, the chosen value(s) and the label to show on a chip. */
export type DataFilter = {
  param: string;
  values: string[];
  label?: string;
};

/** A sort as the URL carries it: `name-asc`, `recent`. `null` is the module's default order. */
export type DataSort = { value: string } | null;

/** Everything a list's query holds. */
export type DataQueryState = {
  search: string;
  filters: DataFilter[];
  sort: DataSort;
  page: number;
  limit: number | null;
  /** Any other route key (section, scope) the list keeps while these change. */
  other: Record<string, string>;
};

/** The ids a person has ticked. Ids are canonical record ids, never row positions. */
export type DataSelectionState = {
  active: boolean;
  ids: ReadonlySet<string>;
};

/**
 * How a record reads on a phone (MOB-03 §11): which parts fill which slot.
 * Slots are already-rendered content; picking a slot never fetches or reveals
 * a field the server did not send.
 */
export type MobileRecordPresentation<T> = {
  subtitle?: (record: T) => React.ReactNode;
  status?: (record: T) => React.ReactNode;
  value?: (record: T) => React.ReactNode;
  leading?: (record: T) => React.ReactNode;
  /** A short spoken summary of the record, e.g. "Unit A-101, For sale, floor 10". */
  label?: (record: T) => string;
  /** `row` is the compact identity-first pattern (people, files); `card` the default. */
  variant?: "card" | "row";
};

export type QueryKeys = {
  search: string;
  sort: string;
  page: string;
  limit: string;
  /** The filter params this list owns. */
  filters: readonly string[];
};

export const DEFAULT_QUERY_KEYS: Omit<QueryKeys, "filters"> = { search: "search", sort: "sort", page: "page", limit: "limit" };

export function parseQueryState(query: string | URLSearchParams, keys: Partial<QueryKeys> & { filters: readonly string[] }): DataQueryState {
  const params = new URLSearchParams(typeof query === "string" ? (query.startsWith("?") ? query.slice(1) : query) : query.toString());
  const k = { ...DEFAULT_QUERY_KEYS, ...keys };
  const owned = new Set<string>([k.search, k.sort, k.page, k.limit, ...k.filters]);
  const filters: DataFilter[] = [];
  for (const param of k.filters) {
    const values = params.getAll(param).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
    if (values.length > 0) filters.push({ param, values });
  }
  const other: Record<string, string> = {};
  for (const [key, value] of params) if (!owned.has(key)) other[key] = value;
  const page = Number.parseInt(params.get(k.page) ?? "", 10);
  const limit = Number.parseInt(params.get(k.limit) ?? "", 10);
  const sort = params.get(k.sort);
  return {
    search: params.get(k.search)?.trim() ?? "",
    filters,
    sort: sort ? { value: sort } : null,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    limit: Number.isInteger(limit) && limit > 0 ? limit : null,
    other,
  };
}

export function serializeQueryState(state: DataQueryState, keys: Partial<QueryKeys> & { filters: readonly string[] }): string {
  const k = { ...DEFAULT_QUERY_KEYS, ...keys };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state.other)) params.set(key, value);
  if (state.search) params.set(k.search, state.search);
  for (const filter of state.filters) if (filter.values.length > 0) params.set(filter.param, filter.values.join(","));
  if (state.sort) params.set(k.sort, state.sort.value);
  if (state.limit) params.set(k.limit, String(state.limit));
  if (state.page > 1) params.set(k.page, String(state.page));
  return params.toString();
}

/**
 * How many filters count on the Filters button (MOB-03 §21): filters that hold
 * a value. Search, sort and page are not filters, and a filter set to its
 * default ("All", an empty value) does not count.
 */
export function activeFilterCount(state: Pick<DataQueryState, "filters">, defaults: Readonly<Record<string, string>> = {}): number {
  return state.filters.filter((filter) => filter.values.some((value) => value !== (defaults[filter.param] ?? ""))).length;
}

/**
 * A persistable description of a view (MOB-03 §84): what a future Saved Views
 * feature would store. Page and selection are not part of a view.
 */
export type SavedViewShape = {
  search: string;
  filters: { param: string; values: string[] }[];
  sort: string | null;
  /** Visible fields, by stable column id (docs/tables/list-manifest.md). Empty means the list's default. */
  columns: string[];
  /** The scope the view was made in; a view never widens it. */
  scope: { groupId: string | null; companyId: string | null; projectId: string | null };
};

export function toSavedView(state: DataQueryState, extras: { columns?: string[]; scope: SavedViewShape["scope"] }): SavedViewShape {
  return {
    search: state.search,
    filters: state.filters.map(({ param, values }) => ({ param, values: [...values] })),
    sort: state.sort?.value ?? null,
    columns: extras.columns ?? [],
    scope: extras.scope,
  };
}

/**
 * Filters that no longer make sense after the workspace changed (MOB-03 §59):
 * relation filters (company, project, assignee ids) name records of the old
 * workspace and are dropped; plain value filters (status) are kept. The server
 * would refuse a foreign id anyway; this keeps the URL honest.
 */
export function dropRelationFilters(state: DataQueryState, relationParams: readonly string[]): DataQueryState {
  const drop = new Set(relationParams);
  return { ...state, filters: state.filters.filter((filter) => !drop.has(filter.param)), page: 1 };
}
