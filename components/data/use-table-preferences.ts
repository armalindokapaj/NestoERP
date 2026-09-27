"use client";

import * as React from "react";

import { useTableIdentity } from "@/components/data/table-identity";
import {
  TABLE_PREFERENCES_VERSION,
  browserStorage,
  readTablePreferences,
  tablePreferenceKey,
  writeTablePreferences,
  type StoredTablePreferences,
} from "@/lib/tables/preferences";

/**
 * One list's stored presentation preferences, for the Columns control and the
 * page-size control alike (AUD-08 §5, DT-08).
 *
 * The first render — on the server and on hydration — has no preference, so
 * both draw the defaults and agree; the stored entry is read in an effect,
 * under the key of the identity and workspace the tab shows now. When the key
 * changes, the previous entry is dropped before the new one is read, so one
 * person's or workspace's choice is never applied under another's.
 *
 * Every write re-reads the entry first and changes only its own part, so the
 * Columns control and the page-size control never overwrite each other. A
 * refused write keeps the choice in memory for this page; it never blocks the
 * list (§5 "Storage denial/corruption falls back cleanly").
 */
export type TablePreferencesHandle = {
  /** Null until read, and whenever nothing usable is stored. */
  stored: StoredTablePreferences | null;
  /** The entry has been read for the current identity (whether or not one existed). */
  ready: boolean;
  /** Whether choices are being persisted at all (an identity and a usable list id exist). */
  persistent: boolean;
  update: (change: (current: StoredTablePreferences) => StoredTablePreferences) => void;
};

const EMPTY: StoredTablePreferences = { v: TABLE_PREFERENCES_VERSION, columns: {} };

export function useTablePreferences(listId: string | undefined): TablePreferencesHandle {
  const getIdentity = useTableIdentity();
  const [state, setState] = React.useState<{ key: string | null; stored: StoredTablePreferences | null; ready: boolean }>({
    key: null,
    stored: null,
    ready: false,
  });

  React.useEffect(() => {
    if (!listId) return;
    const key = tablePreferenceKey(getIdentity(), listId);
    setState({ key, stored: readTablePreferences(browserStorage(), key), ready: true });
  }, [listId, getIdentity]);

  // Another tab of the same person changed this list: follow it.
  React.useEffect(() => {
    const key = state.key;
    if (!key || typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key && event.key !== null) return;
      setState((current) => (current.key === key ? { ...current, stored: readTablePreferences(browserStorage(), key) } : current));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [state.key]);

  const latest = React.useRef(state);
  latest.current = state;

  const update = React.useCallback((change: (current: StoredTablePreferences) => StoredTablePreferences) => {
    const { key, stored } = latest.current;
    const storage = browserStorage();
    const base = readTablePreferences(storage, key) ?? stored ?? EMPTY;
    const next = change({ ...base, columns: { ...base.columns } });
    writeTablePreferences(storage, key, next);
    setState((current) => (current.key === key ? { ...current, stored: next } : current));
  }, []);

  return { stored: state.stored, ready: state.ready, persistent: state.key !== null, update };
}
