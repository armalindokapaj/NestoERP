"use client";

import * as React from "react";
import { Bell, X } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { createActivityController, fetchTransport, type ActivityController } from "@/lib/activity/activity-controller";
import { onActivityReset, removeLegacyActivityCache, subscribeActivity } from "@/lib/activity/client";
import { createPanelLoader, usePanelModule, usePanelOpen, useWarmIntent } from "@/lib/navigation/panel-host";
import { cn } from "@/lib/utils/cn";
import { PanelFailure, PanelLoading } from "@/components/layout/panels/panel-frame";
import { handleSessionLost, reconcileTabContext } from "@/components/unsaved/unsaved-host";
import { unsaved } from "@/lib/unsaved/coordinator";

/**
 * The bell (Activity Center PRD §3, §102-§113; NAV-03 §6, §9).
 *
 * The badge and its controller are always here; the panel's list, tabs and
 * actions are a separate chunk, loaded on open or on a deliberate hover. One
 * controller per context and tab owns every count and list read, so opening
 * the panel or changing its tab never restarts a timer (ACTIVITY-02).
 */

const body = createPanelLoader("activity", () => import("@/components/layout/panels/activity-panel-body"));

export function ActivityBell({ contextKey, canManageAnnouncements = false }: { contextKey: string; canManageAnnouncements?: boolean }) {
  const t = useTranslations("activity");
  const panelId = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = usePanelOpen("activity");
  const warm = useWarmIntent(body);
  const { state: code, retry: retryCode } = usePanelModule(body, open);

  const controller = useController(contextKey);
  const snapshot = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  React.useEffect(() => controller.setOpen(open), [controller, open]);

  const close = React.useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) triggerRef.current?.focus();
    },
    [setOpen],
  );

  // Escape and a click outside close it; both work while the body is still loading (PANEL-02).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close(true);
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) close(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  const counts = snapshot.count.value;
  const total = counts?.total ?? 0;
  const critical = (counts?.critical ?? 0) > 0;
  // Unknown until the first answer, never "0 unread"; a failed refresh keeps the last value, marked (ACTIVITY-04).
  const label = counts === null ? t("title") : `${t("title")} — ${t("unreadCount", { count: total })}${snapshot.count.stale ? ` (${t("countStale")})` : ""}`;
  const Body = code.status === "ready" ? code.module.ActivityPanelBody : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        className="relative grid size-9 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg aria-expanded:bg-hover touch:size-11"
        data-testid="notification-bell"
        data-count-state={counts === null ? "unknown" : snapshot.count.stale ? "stale" : "fresh"}
        {...warm}
      >
        <Bell aria-hidden="true" className="size-[18px]" />
        {total > 0 ? (
          <span aria-hidden="true" data-testid="notification-badge" className={cn("absolute right-1 top-1 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold leading-4 ring-2 ring-surface", critical ? "bg-danger text-white" : "bg-accent text-accent-fg", snapshot.count.stale && "opacity-70")}>
            {total > 99 ? "99+" : total}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={t("title")}
          className="fixed inset-0 z-50 flex flex-col bg-surface pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] sm:absolute sm:pb-0 sm:pt-0 sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-[min(36rem,80vh)] sm:w-[min(26rem,calc(100vw-1.5rem))] sm:rounded-lg sm:border sm:border-line sm:shadow-lg"
          data-testid="activity-panel"
        >
          {Body ? (
            <Body controller={controller} snapshot={snapshot} panelId={panelId} canManageAnnouncements={canManageAnnouncements} onClose={close} />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
                <h2 className="text-card font-semibold text-fg">{t("title")}</h2>
                <button type="button" onClick={() => close(true)} aria-label={t("close")} className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover touch:size-11">
                  <X aria-hidden="true" className="size-4" />
                </button>
              </div>
              {code.status === "failed" ? <PanelFailure kind="code" reloadAdvised={code.reloadAdvised} onRetry={retryCode} onClose={() => close(true)} /> : <PanelLoading label={t("loading")} />}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** One controller per context key; a new identity or workspace gets a new one, and the old one stops. */
function controllerFor(contextKey: string): ActivityController {
  return createActivityController({
    contextKey,
    transport: fetchTransport(),
    // Signed out meanwhile: the document load takes the person to sign-in, once
    // — unless this tab holds unsaved work, which is held instead (AUD-03 §7).
    onUnauthenticated: () => handleSessionLost(),
    // An answer for another context: the shell is behind; one reload brings it
    // level. With unsaved work the server's context is checked first.
    onContextMismatch: () => (unsaved.hasBlocking({ kind: "reload" }) ? void reconcileTabContext() : window.location.reload()),
  });
}

function useController(contextKey: string): ActivityController {
  const [controller, setController] = React.useState(() => controllerFor(contextKey));
  const [key, setKey] = React.useState(contextKey);
  if (key !== contextKey) {
    setKey(contextKey);
    setController(controllerFor(contextKey));
  }

  React.useEffect(() => {
    removeLegacyActivityCache();
    controller.start();
    const resume = () => document.visibilityState === "visible" && controller.resume();
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    const unsubscribe = subscribeActivity(() => controller.changed());
    const unreset = onActivityReset(() => controller.reset());
    return () => {
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      unsubscribe();
      unreset();
      controller.stop();
    };
  }, [controller]);

  return controller;
}
