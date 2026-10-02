"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

/**
 * Every page opens, and reloads, at its top.
 *
 * The browser's own scroll restoration is switched off — otherwise a reload or
 * Back would put the page wherever it was left — and the window is returned to
 * the top whenever the route changes. Changes to the query alone (a tab, a
 * filter) leave the scroll where it is, and a `#hash` link still goes to its
 * target.
 */
export function ScrollToTop() {
  const pathname = usePathname();

  React.useLayoutEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  }, []);

  React.useLayoutEffect(() => {
    if (window.location.hash) return;
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
