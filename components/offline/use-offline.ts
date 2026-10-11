"use client";

import * as React from "react";

import { useLocale } from "@/components/i18n/i18n-provider";
import { dateText } from "@/lib/i18n/format";
import { offlineRuntime, type RuntimeState } from "@/lib/offline/runtime";

/** The offline layer's state, live. Renders the server's (empty) snapshot until the client has opened the database. */
export function useOffline(): RuntimeState {
  const runtime = offlineRuntime();
  return React.useSyncExternalStore(runtime.subscribe, runtime.getState, runtime.getServerState);
}

/** Formats an instant for "last synced" lines, in the reader's locale. */
export function useTimeLabel(): (value: number | null) => string {
  const locale = useLocale();
  return React.useCallback((value) => {
    if (value === null) return "";
    const date = new Date(value);
    const sameDay = new Date().toDateString() === date.toDateString();
    return sameDay
      ? dateText(date, { hour: "2-digit", minute: "2-digit" }, locale)
      : dateText(date, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }, locale);
  }, [locale]);
}
