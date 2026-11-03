"use client";

import * as React from "react";

import { useDesignVersion2 } from "@/lib/hooks/use-design-version";

/** The geometry names a measurement may publish; each has a 0px default in styles/globals.css. */
export type MeasuredGeometry = "--nesto-shell-banner-h" | "--nesto-page-sticky-h";

/**
 * Publishes a measured height as a shared geometry token on <html> (UI-02
 * §7.3: "measure … publish offsets through shared geometry tokens"). For the
 * layers whose height no stylesheet can state — a banner that may wrap, a
 * page's own pinned toolbars. The shell's fixed rows (top bar, breadcrumb bar,
 * context tabs) are tokens already and are not measured here.
 *
 * Version 2 only: version 1 keeps the 0px defaults, so its offsets are exactly
 * what they were. The token is withdrawn when the layer unmounts.
 */
export function usePublishedGeometry(name: MeasuredGeometry, height: number | null): void {
  const enabled = useDesignVersion2();
  React.useEffect(() => {
    if (!enabled || height === null) return;
    const root = document.documentElement;
    root.style.setProperty(name, `${height}px`);
    return () => {
      root.style.removeProperty(name);
    };
  }, [enabled, name, height]);
}

/** Measures an element's border-box height, keeps it current and publishes it; nothing at all in version 1. */
export function usePublishedHeight(name: MeasuredGeometry, ref: React.RefObject<HTMLElement | null>): void {
  const enabled = useDesignVersion2();
  const [height, setHeight] = React.useState<number | null>(null);
  React.useEffect(() => {
    const node = ref.current;
    if (!enabled || !node) return;
    const measure = () => setHeight(node.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // One observer per layer, released on unmount: bounded, not global.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
      setHeight(null);
    };
  }, [enabled, ref]);
  usePublishedGeometry(name, height);
}
