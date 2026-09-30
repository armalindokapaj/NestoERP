"use client";

import * as React from "react";

import type { OfflineDatabase } from "@/lib/offline/database";
import { offlineRuntime } from "@/lib/offline/runtime";

import { useOffline } from "../use-offline";

/**
 * Reads from the local database and reads again whenever the queue or a sync
 * changed what is there. `null` while the first read is in flight.
 */
export function useOfflineQuery<T>(load: (db: OfflineDatabase) => Promise<T>, deps: React.DependencyList): T | null {
  const state = useOffline();
  const [value, setValue] = React.useState<T | null>(null);
  const loadRef = React.useRef(load);
  loadRef.current = load;
  const db = state.ready ? offlineRuntime().database : null;
  React.useEffect(() => {
    if (!db) return;
    let cancelled = false;
    loadRef.current(db)
      .then((next) => !cancelled && setValue(next))
      .catch(() => !cancelled && setValue(null));
    return () => {
      cancelled = true;
    };
    // The queue summary and the last sync change whenever the database did.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, state.queue, state.lastSyncAt, state.projects, ...deps]);
  return value;
}
