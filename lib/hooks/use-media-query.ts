"use client";

import { useEffect, useState } from "react";

/**
 * Subscribe to a media query.
 *
 * Always false on the server and on the first client render, so it must only
 * drive things with no layout consequence — enabling tooltips, for instance.
 * Layout itself is decided in CSS (see styles/globals.css) to avoid a flash.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
