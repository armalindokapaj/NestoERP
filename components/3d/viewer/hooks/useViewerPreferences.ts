"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { ViewerQualityLevel } from "@/lib/3d/viewer/viewerQuality";

const STORAGE_KEY = "nesto:project-viewer:preferences";

export type AreaUnit = "m2" | "ft2";

export interface ViewerPreferences {
  areaUnit: AreaUnit;
  reducedMotionOverride: boolean | null;
  interfaceAutoHide: boolean;
  quality: ViewerQualityLevel;
}

export const DEFAULT_VIEWER_PREFERENCES: ViewerPreferences = {
  areaUnit: "m2",
  reducedMotionOverride: null,
  interfaceAutoHide: true,
  quality: "auto",
};

let cached: ViewerPreferences = DEFAULT_VIEWER_PREFERENCES;
const listeners = new Set<() => void>();

function read(): ViewerPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VIEWER_PREFERENCES;
    return { ...DEFAULT_VIEWER_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_VIEWER_PREFERENCES;
  }
}

function write(next: ViewerPreferences) {
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
  }
  listeners.forEach((l) => l());
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
function getSnapshot() {
  return cached;
}
function getServerSnapshot() {
  return DEFAULT_VIEWER_PREFERENCES;
}

export function useViewerPreferences() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setAreaUnit = useCallback((areaUnit: AreaUnit) => write({ ...read(), areaUnit }), []);
  const setReducedMotionOverride = useCallback(
    (reducedMotionOverride: boolean | null) => write({ ...read(), reducedMotionOverride }),
    []
  );
  const setInterfaceAutoHide = useCallback((interfaceAutoHide: boolean) => write({ ...read(), interfaceAutoHide }), []);
  const setQuality = useCallback((quality: ViewerQualityLevel) => write({ ...read(), quality }), []);
  const reset = useCallback(() => write(DEFAULT_VIEWER_PREFERENCES), []);

  return { ...prefs, setAreaUnit, setReducedMotionOverride, setInterfaceAutoHide, setQuality, reset };
}

if (typeof window !== "undefined") {
  cached = read();
}
