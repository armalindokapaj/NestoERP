"use client";

import { usePrefersReducedMotion } from "./useMediaQuery";
import { useViewerPreferences } from "./useViewerPreferences";

export function useEffectiveReducedMotion() {
  const osPrefers = usePrefersReducedMotion();
  const { reducedMotionOverride } = useViewerPreferences();
  if (reducedMotionOverride === true) return true;
  return osPrefers;
}
