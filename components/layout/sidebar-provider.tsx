"use client";

import * as React from "react";

import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { SIDEBAR_COOKIE, type SidebarState } from "@/lib/layout/sidebar-state";
import { theme } from "@/config/theme";

type SidebarContextValue = {
  state: SidebarState;
  toggle: () => void;
  /**
   * True when navigation is showing as a 72px icon rail — either because the
   * user collapsed it, or because the viewport is tablet-landscape sized and
   * there is no room for labels (§43, §44).
   */
  isRail: boolean;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

/**
 * Owns the sidebar's collapse state and renders the shell element that CSS
 * keys off (design spec §14).
 *
 * The initial value comes from the server, so `data-sidebar` is already
 * correct in the HTML and the layout never flashes at its other width.
 */
export function SidebarProvider({
  initial,
  className,
  workspaceRail = false,
  children,
}: {
  initial: SidebarState;
  className?: string;
  /** The far-left workspace rail is drawn (the person can work in more than one workspace). */
  workspaceRail?: boolean;
  children: React.ReactNode;
}) {
  const [state, setState] = React.useState<SidebarState>(initial);

  /* Between 1024px and the desktop breakpoint the rail is forced, whatever the
     user chose on a wider screen. */
  const forcedRail = useMediaQuery(
    `(min-width: ${theme.breakpoints.navRail}px) and (max-width: ${theme.breakpoints.desktop - 0.02}px)`,
  );
  const isDesktop = useMediaQuery(`(min-width: ${theme.breakpoints.desktop}px)`);

  const toggle = React.useCallback(() => {
    setState((current) => {
      const next: SidebarState = current === "expanded" ? "collapsed" : "expanded";
      // A year is fine: this is a display preference, not a session concern.
      document.cookie = `${SIDEBAR_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }, []);

  const value = React.useMemo(
    () => ({
      state,
      toggle,
      isRail: forcedRail || (isDesktop && state === "collapsed"),
    }),
    [state, toggle, forcedRail, isDesktop],
  );

  return (
    <SidebarContext.Provider value={value}>
      <div data-sidebar={state} data-workspace-rail={workspaceRail ? "" : undefined} className={className}>
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used inside <SidebarProvider>.");
  }
  return context;
}
