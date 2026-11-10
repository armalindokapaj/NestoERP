"use client";

import * as React from "react";

import { openUnitOf, PANEL_PARAM, withOpenUnit, type PanelField } from "@/lib/modules/project-structure/unit-panel.rules";

/**
 * Which unit the side panel shows, kept in the address as `?unit=` (2026-11-09),
 * so a link opens it, a refresh keeps it, and the browser's Back closes it.
 *
 * Opening pushes one history entry, marked as the panel's own; stepping to the
 * previous or next unit replaces it, so Back still closes the panel rather than
 * walking through every unit seen. Closing an entry the panel pushed steps back
 * (Forward opens it again); a panel opened by a link just drops the parameter.
 *
 * The entries carry Next's own state, as the lists' filter addresses do
 * (`writeUrl`): Next takes them for its own and leaves its router as it was,
 * so opening a unit re-renders nothing but the panel — no server round trip,
 * no new entry in the shell's own back-and-forward list. The panel keeps its
 * own state and reads the address itself, on Back and Forward and on arrival.
 */

const MARK = "nestoUnitPanel";

function pushedHere(): boolean {
  const state = window.history.state as Record<string, unknown> | null;
  return Boolean(state && state[MARK]);
}

/** The current entry's state — Next's included — with the panel's mark. */
function entryState(mark: boolean): Record<string, unknown> {
  const state = window.history.state as Record<string, unknown> | null;
  return { ...(state && typeof state === "object" ? state : {}), [MARK]: mark };
}

export type UnitPanelNav = {
  /** The open unit, or null when the panel is closed. */
  openId: string | null;
  /** The field an empty cell's "Add" asked for, focused when the panel opens. */
  focus: PanelField | null;
  open: (unitId: string, focus?: PanelField | null) => void;
  close: () => void;
  /** Runs before a close steps back: lets the panel's own editor go first, so the history guard does not ask a second time. */
  beforeClose: React.MutableRefObject<(() => void) | null>;
};

export function useUnitPanelNav(initial: string | null): UnitPanelNav {
  const [openId, setOpenId] = React.useState<string | null>(initial);
  const [focus, setFocus] = React.useState<PanelField | null>(null);
  const current = React.useRef(openId);
  current.current = openId;
  const beforeClose = React.useRef<(() => void) | null>(null);

  // Back and Forward, and a page Next brings back from its cache: the address says which unit is open.
  React.useEffect(() => {
    const read = () => {
      const fromAddress = openUnitOf(window.location.search);
      if (fromAddress === current.current) return;
      current.current = fromAddress;
      setOpenId(fromAddress);
      setFocus(null);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const open = React.useCallback((unitId: string, field: PanelField | null = null) => {
    const href = withOpenUnit(window.location.href, unitId);
    if (current.current) window.history.replaceState(entryState(pushedHere()), "", href);
    else window.history.pushState(entryState(true), "", href);
    current.current = unitId;
    setOpenId(unitId);
    setFocus(field);
  }, []);

  const close = React.useCallback(() => {
    if (!current.current) return;
    beforeClose.current?.();
    current.current = null;
    setOpenId(null);
    setFocus(null);
    if (pushedHere() && openUnitOf(window.location.search)) window.history.back();
    else window.history.replaceState(entryState(false), "", withOpenUnit(window.location.href, null));
  }, []);

  return React.useMemo(() => ({ openId, focus, open, close, beforeClose }), [openId, focus, open, close]);
}

/** The list's own address without losing the open unit: the lists rewrite their query as filters change. */
export function keepOpenUnit(params: URLSearchParams): URLSearchParams {
  const open = openUnitOf(window.location.search);
  if (open) params.set(PANEL_PARAM, open);
  return params;
}
