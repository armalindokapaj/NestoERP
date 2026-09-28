"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { LIFECYCLE_KEY, leaveSession, isSessionEnding } from "@/lib/auth/client-lifecycle";
import { resetUserScopedClientState } from "@/components/layout/user-scoped-state";
import { isPublicRoute } from "@/lib/permissions/route-access";
import { unsaved } from "@/lib/unsaved/coordinator";

/** Mounted above every layout, including standalone editors and platform admin. */
export function SessionLifecycle() {
  const pathname = usePathname();
  const protectedPage = !isPublicRoute(pathname);
  useEffect(() => {
    if (!protectedPage) { resetUserScopedClientState(); return; }
    let disposed = false;
    let checking = false;
    let identity: string | undefined;
    let user: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let validation: AbortController | undefined;
    const requests = new Set<AbortController>();
    const original = window.fetch;
    const expire = () => {
      if (disposed || isSessionEnding()) return;
      resetUserScopedClientState();
      if (unsaved.hasBlocking({ kind: "reload" })) {
        // Existing editor guard masks the page and holds writes while the same
        // person reauthenticates in another tab. No draft is persisted to disk.
        unsaved.freeze({ reason: "session-expired" });
      } else leaveSession("session-expired");
    };
    const wrapped: typeof fetch = async (input, init) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request ? request.url : String(input), location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/api/auth/")) return original(input, init);
      const controller = new AbortController();
      const signal = init?.signal ?? request?.signal;
      const abort = () => controller.abort();
      if (signal?.aborted) abort();
      signal?.addEventListener("abort", abort, { once: true });
      requests.add(controller);
      try {
        const response = await original(input, { ...init, signal: controller.signal });
        if (response.status === 401) void check();
        return response;
      } finally {
        requests.delete(controller);
        signal?.removeEventListener("abort", abort);
      }
    };
    window.fetch = wrapped;
    const check = async () => {
      if (checking || disposed || isSessionEnding()) return;
      checking = true;
      clearTimeout(timer);
      timer = setTimeout(() => void check(), 60_000);
      validation = new AbortController();
      const timeout = setTimeout(() => validation?.abort(), 10_000);
      try {
        const response = await original("/api/auth/lifecycle", { cache: "no-store", signal: validation.signal });
        if (disposed || isSessionEnding()) return;
        if (response.status === 401) { expire(); return; }
        if (!response.ok) return;
        const state = await response.json() as { identity: string; user: string; remainingMs: number };
        if (disposed || isSessionEnding()) return;
        if (identity && identity !== state.identity && !(user === state.user && unsaved.hasBlocking({ kind: "reload" }))) {
          resetUserScopedClientState();
          unsaved.forceLeave();
          document.documentElement.setAttribute("data-nesto-covered", "");
          for (const controller of requests) controller.abort();
          location.reload();
          return;
        }
        identity = state.identity;
        user = state.user;
        clearTimeout(timer);
        // Duration is computed using server time, never the workstation clock.
        timer = setTimeout(() => void check(), Math.max(100, Math.min(state.remainingMs, 60_000)));
      } catch { /* Offline is not evidence of expiration. Recheck on focus. */ }
      finally { clearTimeout(timeout); checking = false; }
    };
    const abortRequests = () => { for (const controller of requests) controller.abort(); };
    const terminate = () => {
      // Ignore an old queued message after a successful new sign-in.
      if (!document.cookie.split("; ").includes("nesto.signed-out=1")) return;
      abortRequests();
      leaveSession("signed-out");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === LIFECYCLE_KEY && event.newValue) terminate();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        document.documentElement.setAttribute("data-nesto-covered", "");
        location.reload();
      }
    };
    const onPageHide = () => document.documentElement.setAttribute("data-nesto-covered", "");
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("nesto:session-ended", abortRequests);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(LIFECYCLE_KEY);
    if (channel) channel.onmessage = (event) => { if (event.data?.type === "logout") terminate(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    window.addEventListener("pageshow", onPageShow);
    void check();
    return () => {
      disposed = true;
      validation?.abort();
      clearTimeout(timer);
      if (window.fetch === wrapped) window.fetch = original;
      channel?.close();
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("nesto:session-ended", abortRequests);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [protectedPage]);
  return null;
}
