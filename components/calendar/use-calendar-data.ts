"use client";

import * as React from "react";

import type { CalendarCategory, CalendarEventDTO, CalendarResponse } from "@/lib/modules/calendar/calendar.types";

/**
 * Loads the calendar for a range (PRD #39 §64, §124, §172).
 *
 * The previous range stays on screen while the next one loads, so moving a
 * week never blanks the page. A newer request cancels an older one. Changes
 * made in the drawer are applied locally at once and then reconciled with a
 * refetch; there is no realtime channel in V0.1.
 */

export type CalendarFilterState = {
  myOnly: boolean;
  categories: CalendarCategory[];
  projectIds: string[];
};

export const EMPTY_FILTERS: CalendarFilterState = { myOnly: false, categories: [], projectIds: [] };

export function useCalendarData(range: { from: Date; to: Date }, filters: CalendarFilterState, initial: CalendarResponse | null) {
  const [data, setData] = React.useState<CalendarResponse | null>(initial);
  const [loading, setLoading] = React.useState(!initial);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const skipFirst = React.useRef(Boolean(initial));

  const key = `${range.from.toISOString()}|${range.to.toISOString()}|${filters.myOnly}|${filters.categories.join(",")}|${filters.projectIds.join(",")}|${nonce}`;

  React.useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString() });
    if (filters.myOnly) params.set("myOnly", "true");
    for (const category of filters.categories) params.append("categories", category);
    for (const projectId of filters.projectIds) params.append("projectIds", projectId);

    setLoading(true);
    fetch(`/api/calendar/events?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        setData((await response.json()) as CalendarResponse);
        setError(null);
      })
      .catch((failure: Error) => {
        if (failure.name !== "AbortError") setError("Some calendar items could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // `key` captures every input that changes the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = React.useCallback(() => setNonce((value) => value + 1), []);

  /** Optimistic local edit of one Calendar-owned event's occurrences (PRD #39 §171). */
  const patchEvents = React.useCallback((sourceId: string, patch: (event: CalendarEventDTO) => CalendarEventDTO | null) => {
    setData((current) =>
      current
        ? {
            ...current,
            events: current.events
              .map((event) => (event.sourceType === "calendar_event" && event.sourceId === sourceId ? patch(event) : event))
              .filter((event): event is CalendarEventDTO => event !== null),
          }
        : current,
    );
  }, []);

  return { data, loading, error, reload, patchEvents, setData };
}

const STORAGE_KEY = "nesto.calendar.preferences.v1";

export type StoredPreferences = { view?: string; sidebarCollapsed?: boolean; filters?: CalendarFilterState };

export function readPreferences(): StoredPreferences {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as StoredPreferences;
  } catch {
    return {};
  }
}

export function writePreferences(patch: StoredPreferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readPreferences(), ...patch }));
  } catch {
    // Private mode or a full quota: preferences are a convenience, not state.
  }
}
