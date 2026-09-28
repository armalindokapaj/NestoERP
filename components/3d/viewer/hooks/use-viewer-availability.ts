"use client";

import * as React from "react";

/**
 * Keeps an open viewer honest about whether it may still show what it shows
 * (ADM-04A §8, EV-13). While the tab is visible it asks every 15 seconds, and
 * at once when the tab regains focus or a model request fails. A refusal
 * reports "revoked" — the caller clears the scene — and a new release or grant
 * reports "changed", which the caller offers as a reload rather than retrying
 * on its own.
 */

export const VIEWER_STATUS_INTERVAL_MS = 15_000;

export type ViewerAvailability = "current" | "changed" | "revoked";

export function useViewerAvailability(input: {
  statusUrl: string;
  /** The token the loaded bootstrap came with; null while nothing is loaded. */
  token: string | null;
  /** Reads the status response: still viewable, and the current token. */
  read: (body: unknown) => { available: boolean; token: string | null };
}): { availability: ViewerAvailability; check: () => void } {
  const { statusUrl, token, read } = input;
  const [availability, setAvailability] = React.useState<ViewerAvailability>("current");
  const inFlight = React.useRef(false);

  React.useEffect(() => setAvailability("current"), [token]);

  const check = React.useCallback(() => {
    if (!token || inFlight.current) return;
    inFlight.current = true;
    void (async () => {
      try {
        const response = await fetch(statusUrl, { cache: "no-store", credentials: "same-origin" });
        // A signed-out or forbidden answer is a revocation; a server hiccup is not.
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          setAvailability("revoked");
          return;
        }
        if (!response.ok) return;
        const status = read((await response.json() as { data?: unknown }).data);
        if (!status.available) setAvailability("revoked");
        else if (status.token !== token) setAvailability("changed");
      } catch {
        // Offline: keep what is shown until an answer arrives.
      } finally {
        inFlight.current = false;
      }
    })();
  }, [read, statusUrl, token]);

  React.useEffect(() => {
    if (!token) return;
    const tick = () => {
      if (document.visibilityState === "visible") check();
    };
    const timer = window.setInterval(tick, VIEWER_STATUS_INTERVAL_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [check, token]);

  return { availability, check };
}
