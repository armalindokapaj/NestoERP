"use client";

import * as React from "react";

/**
 * A workaround for vercel/next.js#86151, found in NAV-01's release run.
 *
 * With loading boundaries in place, a soft navigation on Next 15.5 (React
 * 19.2 canary) sometimes receives its page from the server and never shows
 * it. The render that would commit it waits to be woken, and nothing wakes it
 * until some other update reaches the root. Measured on a production build,
 * the HR attendance, compensation and organization report tabs held the old
 * page for 10–44 s. Adding two plain `loading.tsx` files to the pre-NAV-01
 * tree was enough to reproduce it.
 *
 * Any update that reaches the root makes React retry the waiting render, so
 * these components re-render themselves — drawing nothing — at the moments a
 * stall can be ended. That is just after each server-component response
 * lands, and every 250 ms while a navigation the shell began is pending or a
 * skeleton is on screen. Remove this with the Next.js upgrade that fixes the
 * bug.
 */
export const REVEAL_WATCHDOG_MS = 250;

export function useRevealWatchdog(active: boolean): void {
  const [, setBeat] = React.useState(0);
  React.useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setBeat((beat) => beat + 1), REVEAL_WATCHDOG_MS);
    return () => window.clearInterval(timer);
  }, [active]);
}

/**
 * Beats right after each server-component response lands (`_rsc=` in its
 * resource timing entry), when a stalled navigation has everything it needs.
 * This covers navigations nobody began a ticket for — a component's own
 * `router.push`, a redirect — and costs nothing while nothing is loading.
 */
export const AFTER_RESPONSE_BEATS_MS = [16, 60, 150, 300, 600];

export function useResponseBeats(): void {
  const [, setBeat] = React.useState(0);
  React.useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    const timers = new Set<number>();
    const observer = new PerformanceObserver((list) => {
      if (!list.getEntries().some((entry) => entry.name.includes("_rsc="))) return;
      for (const delay of AFTER_RESPONSE_BEATS_MS) {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          setBeat((beat) => beat + 1);
        }, delay);
        timers.add(timer);
      }
    });
    try {
      observer.observe({ type: "resource" });
    } catch {
      return;
    }
    return () => {
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);
}

/** For a loading surface: it keeps the beat for as long as it is on screen. */
export function RevealWatchdog(): null {
  useRevealWatchdog(true);
  return null;
}
