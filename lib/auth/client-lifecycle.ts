"use client";

import { resetUserScopedClientState } from "@/components/layout/user-scoped-state";
import { clearTabContext } from "@/lib/unsaved/tab-context";
import { unsaved } from "@/lib/unsaved/coordinator";

export const LIFECYCLE_KEY = "nesto.auth.lifecycle";
let pendingLogout: Promise<void> | undefined;
let ending = false;
export const isSessionEnding = () => ending;

export function clearAuthenticationState(blockSession = true): void {
  clearTabContext();
  try { unsaved.forceLeave(); } catch { /* Continue terminating. */ }
  try { resetUserScopedClientState(); } catch { /* A cache subscriber cannot block logout. */ }
  // HttpOnly credentials are cleared by the server. This local denial marker
  // also prevents a failed/offline logout from reopening the old cookie session.
  try { if (blockSession) document.cookie = `nesto.signed-out=1; Path=/; Max-Age=28800; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; } catch { /* Cookies may be disabled. */ }
  document.documentElement.setAttribute("data-nesto-covered", "");
  window.dispatchEvent(new Event("nesto:session-ended"));
}

export function leaveSession(reason: "signed-out" | "session-expired"): void {
  ending = true;
  // An old 401 may arrive after another tab signs in. Expiration must never
  // place a browser-wide denial marker over that new session.
  clearAuthenticationState(reason === "signed-out");
  window.location.replace(`/login?reason=${reason}`);
}

/** One idempotent operation, with a bounded wait even when the network hangs. */
export function logout(): Promise<void> {
  if (pendingLogout) return pendingLogout;
  ending = true;
  pendingLogout = (async () => {
    clearAuthenticationState();
    try { localStorage.setItem(LIFECYCLE_KEY, JSON.stringify({ type: "logout", nonce: crypto.randomUUID() })); } catch { /* Storage may be disabled. */ }
    try { if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(LIFECYCLE_KEY);
      channel.postMessage({ type: "logout" });
      channel.close();
    } } catch { /* Storage events and server checks also synchronize tabs. */ }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      await fetch("/api/auth/lifecycle", { method: "POST", credentials: "same-origin", signal: controller.signal });
    } catch { /* Local termination is unconditional. */ }
    finally {
      clearTimeout(timer);
      window.location.replace("/login?reason=signed-out");
    }
  })();
  return pendingLogout;
}
