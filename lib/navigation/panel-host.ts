"use client";

import * as React from "react";

import { recordPanelReady } from "@/lib/navigation/telemetry-registry";

/**
 * The top bar's panels, loaded when they are wanted (NAV-03 §6).
 *
 * - One overlay at a time: opening one closes the other (RUNTIME-01).
 * - A panel's body is a separate chunk behind a stable loader. The loader
 *   forgets a rejected attempt on reset, but Turbopack's runtime keeps a
 *   chunk's failed load for the document's life, so the panel offers Reload
 *   rather than an in-page retry (PANEL-03; see panel-frame.tsx).
 * - Code warming on a deliberate hover or focus, within two speculative loads
 *   a minute, never while hidden, offline, on Save-Data or 2g (PANEL-06).
 */

export type PanelId = "search" | "quick_create" | "activity" | "workspace";

/** Every top-bar overlay that takes part in "one at a time": the lazy panels, and the account panel, which has no chunk of its own. */
export type OverlayId = PanelId | "account";

let active: OverlayId | null = null;
const listeners = new Set<() => void>();

function setActive(next: OverlayId | null) {
  if (active === next) return;
  active = next;
  for (const listener of listeners) listener();
}

/** Whether this panel is the open one, and a setter that closes any other. */
export function usePanelOpen(id: OverlayId): [boolean, (open: boolean) => void] {
  const current = React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => active,
    () => null,
  );
  const set = React.useCallback((open: boolean) => setActive(open ? id : active === id ? null : active), [id]);
  return [current === id, set];
}

/** A changed context or identity closes every panel. */
export function closeAllPanels(): void {
  setActive(null);
}

export type PanelLoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; module: T }
  | { status: "failed"; reloadAdvised: boolean };

export type PanelLoader<T> = {
  id: PanelId;
  /** The loaded module, or the attempt in flight. */
  load(): Promise<T>;
  /** Replaces a rejected attempt; the next load() imports again. */
  reset(): void;
  peek(): T | null;
  failures(): number;
};

/** A module-level loader: one identity for the page's life, whatever re-renders. */
export function createPanelLoader<T>(id: PanelId, importer: () => Promise<T>): PanelLoader<T> {
  let attempt: Promise<T> | null = null;
  let loaded: T | null = null;
  let failed = 0;
  return {
    id,
    load() {
      if (loaded) return Promise.resolve(loaded);
      attempt ??= importer().then(
        (loadedModule) => {
          loaded = loadedModule;
          return loadedModule;
        },
        (error: unknown) => {
          failed += 1;
          throw error;
        },
      );
      return attempt;
    },
    reset() {
      if (!loaded) attempt = null;
    },
    peek: () => loaded,
    failures: () => failed,
  };
}

/** Loads the panel's code while `wanted`, and exposes a retry that replaces a failed attempt. */
export function usePanelModule<T>(loader: PanelLoader<T>, wanted: boolean): { state: PanelLoadState<T>; retry: () => void } {
  const [state, setState] = React.useState<PanelLoadState<T>>(() => {
    const ready = loader.peek();
    return ready ? { status: "ready", module: ready } : { status: "idle" };
  });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (!wanted) return;
    const ready = loader.peek();
    if (ready) {
      setState({ status: "ready", module: ready });
      recordPanelReady(loader.id, performance.now(), false);
      return;
    }
    let live = true;
    const startedAt = performance.now();
    setState({ status: "loading" });
    loader.load().then(
      (loadedModule) => {
        if (!live) return;
        setState({ status: "ready", module: loadedModule });
        recordPanelReady(loader.id, startedAt, true);
      },
      () => {
        if (!live) return;
        setState({ status: "failed", reloadAdvised: loader.failures() >= 2 });
        recordPanelReady(loader.id, startedAt, true, "error");
      },
    );
    return () => {
      live = false;
    };
  }, [loader, wanted, attempt]);

  const retry = React.useCallback(() => {
    loader.reset();
    setAttempt((count) => count + 1);
  }, [loader]);

  return { state, retry };
}

const WARM_LIMIT = 2;
const WARM_WINDOW_MS = 60_000;
const WARM_GAP_MS = 1_500;
const warmed: number[] = [];

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

function speculationAllowed(): boolean {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
  if (typeof navigator !== "undefined") {
    if (navigator.onLine === false) return false;
    const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
    if (connection?.saveData) return false;
    if (connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g") return false;
  }
  return true;
}

/** Loads a panel's code ahead of an open, if the speculative budget allows. Starts no data read. */
export function warmPanel(loader: PanelLoader<unknown>, now = Date.now()): boolean {
  if (loader.peek() || !speculationAllowed()) return false;
  while (warmed.length && now - warmed[0] > WARM_WINDOW_MS) warmed.shift();
  if (warmed.length >= WARM_LIMIT) return false;
  if (warmed.length && now - warmed[warmed.length - 1] < WARM_GAP_MS) return false;
  warmed.push(now);
  loader.load().catch(() => loader.reset());
  return true;
}

/** Hover for 200 ms or focus for 150 ms on a trigger warms its panel (PANEL-06). */
export function useWarmIntent(loader: PanelLoader<unknown>) {
  const timer = React.useRef<number | null>(null);
  const cancel = React.useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const arm = React.useCallback(
    (ms: number) => {
      cancel();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        warmPanel(loader);
      }, ms);
    },
    [cancel, loader],
  );
  React.useEffect(() => cancel, [cancel]);
  return {
    onPointerEnter: (event: React.PointerEvent) => event.pointerType === "mouse" && arm(200),
    onPointerLeave: cancel,
    onFocus: () => arm(150),
    onBlur: cancel,
  };
}

/** Test seam: forget the speculative budget. */
export function resetPanelWarmingForTests(): void {
  warmed.length = 0;
  active = null;
}
