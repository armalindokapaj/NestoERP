import { isColumnId, isListId, type ColumnMeta } from "@/lib/tables/columns";

/**
 * Local table presentation preferences (AUD-08 §5, DT-08, DT-09).
 *
 * One browser-storage entry per signed-in person, workspace and list:
 *
 *   nesto.table.v1:<user key>:<workspace key>:<list id>
 *
 * The user key is the shell's opaque digest of the user id (AUD-03's
 * `identityKeys`), so the raw id never lands in storage; the workspace key is
 * `workspaceKey()` (`COMPANY:<id>` / `GROUP:<id>`). The entry holds a schema
 * version, the columns the person turned away from their default, and a page
 * size — nothing else. No record values, selections, query text, names or
 * credentials (§5). It is a presentation convenience on this device, not a
 * cross-device promise, and it never feeds authorization: the server decides
 * what a row or an export may contain before any column is drawn (DT-09).
 *
 * Everything read back is validated against the columns the table has now:
 * removed or unknown ids are dropped, mandatory columns are never hidden, new
 * columns take their defaults, and anything malformed or unreadable reads as
 * "no preference". Storage that throws (a private window, blocked site data)
 * is treated the same way and never stops the list from rendering.
 */

export const TABLE_PREFERENCES_VERSION = 1 as const;
const KEY_PREFIX = `nesto.table.v${TABLE_PREFERENCES_VERSION}`;
/** More entries than any table has columns: anything bigger is not ours. */
const MAX_COLUMN_ENTRIES = 64;
const MAX_RAW_LENGTH = 4096;
const MAX_PAGE_SIZE = 100;

export type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type StoredTablePreferences = {
  v: typeof TABLE_PREFERENCES_VERSION;
  /** Only the choices that differ from the column's default, by column id. */
  columns: Record<string, boolean>;
  pageSize?: number;
};

export type TableIdentity = {
  /** Opaque key of the signed-in person (never the raw user id). */
  user: string;
  /** `workspaceKey()` of the active workspace. */
  workspace: string;
};

/** The storage key, or null when the identity or list id is not usable — then nothing is stored. */
export function tablePreferenceKey(identity: TableIdentity | null | undefined, listId: string): string | null {
  if (!identity || !isListId(listId)) return null;
  const user = identity.user?.trim();
  const workspace = identity.workspace?.trim();
  if (!user || !workspace || /\s/.test(user) || /\s/.test(workspace)) return null;
  return `${KEY_PREFIX}:${user}:${workspace}:${listId}`;
}

/** `window.localStorage`, or null where reading it throws or there is no window. */
export function browserStorage(): PreferenceStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function isPageSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PAGE_SIZE;
}

/**
 * Parses and validates one stored entry. Anything that is not exactly our
 * shape — wrong version, non-boolean values, bad ids, oversized — is either
 * trimmed to its valid part or read as null. Never throws.
 */
export function parseTablePreferences(raw: string | null | undefined): StoredTablePreferences | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RAW_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== TABLE_PREFERENCES_VERSION) return null;

  const columns: Record<string, boolean> = {};
  const source = record.columns;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    let count = 0;
    for (const [id, visible] of Object.entries(source as Record<string, unknown>)) {
      if (count >= MAX_COLUMN_ENTRIES) break;
      if (!isColumnId(id) || typeof visible !== "boolean") continue;
      columns[id] = visible;
      count += 1;
    }
  }
  const result: StoredTablePreferences = { v: TABLE_PREFERENCES_VERSION, columns };
  if (isPageSize(record.pageSize)) result.pageSize = record.pageSize;
  return result;
}

export function readTablePreferences(storage: PreferenceStorage | null, key: string | null): StoredTablePreferences | null {
  if (!storage || !key) return null;
  try {
    return parseTablePreferences(storage.getItem(key));
  } catch {
    return null;
  }
}

/**
 * Writes one entry; an empty one (no column choices, no page size) removes
 * the key instead. Returns false when storage refused — the choice then lasts
 * for this page only, which is all a blocked store can offer.
 */
export function writeTablePreferences(
  storage: PreferenceStorage | null,
  key: string | null,
  preferences: StoredTablePreferences,
): boolean {
  if (!storage || !key) return false;
  try {
    const columns: Record<string, boolean> = {};
    for (const [id, visible] of Object.entries(preferences.columns)) {
      if (isColumnId(id) && typeof visible === "boolean") columns[id] = visible;
    }
    const clean: StoredTablePreferences = { v: TABLE_PREFERENCES_VERSION, columns };
    if (isPageSize(preferences.pageSize)) clean.pageSize = preferences.pageSize;
    if (Object.keys(columns).length === 0 && clean.pageSize === undefined) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

/** Whether a column shows by default (mandatory ones always do). */
export function defaultVisible(column: ColumnMeta): boolean {
  return column.mandatory || !column.defaultHidden;
}

/**
 * The ids to hide, given the table's current columns and what was stored.
 * Unknown/removed ids are ignored, mandatory columns are never hidden, a
 * column with an unusable id is never hidden, and a column with no stored
 * choice takes its current default (so new columns merge in).
 */
export function resolveHiddenColumns(
  columns: readonly ColumnMeta[],
  stored: StoredTablePreferences | null,
): string[] {
  const hidden: string[] = [];
  for (const column of columns) {
    if (column.mandatory || !isColumnId(column.id)) continue;
    const choice = stored?.columns[column.id];
    const visible = typeof choice === "boolean" ? choice : defaultVisible(column);
    if (!visible) hidden.push(column.id);
  }
  return hidden;
}

/**
 * The stored form of a visibility choice: only the deviations from each
 * column's default, only for optional columns the table has. Resetting is the
 * empty map, so it always lands on the current defaults (§5 "Reset restores
 * the current manifest defaults").
 */
export function columnChoices(columns: readonly ColumnMeta[], hidden: readonly string[]): Record<string, boolean> {
  const hiddenSet = new Set(hidden);
  const choices: Record<string, boolean> = {};
  for (const column of columns) {
    if (column.mandatory || !isColumnId(column.id)) continue;
    const visible = !hiddenSet.has(column.id);
    if (visible !== defaultVisible(column)) choices[column.id] = visible;
  }
  return choices;
}

/** A remembered page size, only when the list offers it. */
export function resolvePageSize(stored: StoredTablePreferences | null, allowed: readonly number[]): number | null {
  const size = stored?.pageSize;
  return typeof size === "number" && allowed.includes(size) ? size : null;
}

/**
 * The page size a list should request (AUD-08 §5, DT-09): an explicit URL
 * `limit` always wins; otherwise a remembered size the list offers; otherwise
 * nothing (the module's own default applies).
 */
export function effectivePageSize(
  urlLimit: string | null | undefined,
  stored: StoredTablePreferences | null,
  allowed: readonly number[],
): { source: "url" | "preference" | "default"; size: number | null } {
  if (urlLimit != null && urlLimit !== "") return { source: "url", size: null };
  const remembered = resolvePageSize(stored, allowed);
  return remembered === null ? { source: "default", size: null } : { source: "preference", size: remembered };
}
