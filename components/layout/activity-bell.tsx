"use client";

import * as React from "react";
import { Bell, X } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { createActivityController, fetchTransport, type ActivityController } from "@/lib/activity/activity-controller";
import { onActivityReset, removeLegacyActivityCache, subscribeActivity } from "@/lib/activity/client";
import { onDataRefresh } from "@/lib/navigation/refresh-event";
import { createPanelLoader, usePanelModule, usePanelOpen, useWarmIntent } from "@/lib/navigation/panel-host";
import { cn } from "@/lib/utils/cn";
import { PanelFailure, PanelLoading } from "@/components/layout/panels/panel-frame";
import { aimPointer, PanelPointer } from "@/components/ui/popup-pointer";
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

/**
 * The bell, in the top bar at every width: the phone's ribbons keep the bottom
 * of the screen for the page and for moving around (docs/ui/UI-04-navigation-layouts.md),
 * so there is one controller and one `notification-bell`.
 */
/*
 * The unread count, for the phone's Inbox (components/layout/phone-bar.tsx).
 * The bell keeps the one controller for the context (below lg it is mounted
 * but not drawn), and hands its count on: never a second feed of its own.
 */
let unread: number | null = null;
const unreadListeners = new Set<() => void>();

function publishUnread(next: number | null) {
  if (next === unread) return;
  unread = next;
  for (const listener of unreadListeners) listener();
}

/** The bell's unread count; null until its first answer, never a guessed zero. */
export function useUnreadActivity(): number | null {
  return React.useSyncExternalStore(
    (listener) => {
      unreadListeners.add(listener);
      return () => unreadListeners.delete(listener);
    },
    () => unread,
    () => null,
  );
}

export function ActivityBell({ contextKey, canManageAnnouncements = false }: { contextKey: string; canManageAnnouncements?: boolean }) {
  return <BellControl contextKey={contextKey} canManageAnnouncements={canManageAnnouncements} />;
}

function BellControl({ contextKey, canManageAnnouncements }: { contextKey: string; canManageAnnouncements: boolean }) {
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
  React.useEffect(() => publishUnread(counts === null ? null : total), [counts, total]);
  // Unknown until the first answer, never "0 unread"; a failed refresh keeps the last value, marked (ACTIVITY-04).
  const label = counts === null ? t("title") : `${t("title")} — ${t("unreadCount", { count: total })}${snapshot.count.stale ? ` (${t("countStale")})` : ""}`;
  const Body = code.status === "ready" ? code.module.ActivityPanelBody : null;

  // On a touch layout the panel carries a pointer: it is aimed at the bell.
  React.useLayoutEffect(() => {
    if (!open) return;
    const aim = () => aimPointer(panelRef.current, triggerRef.current);
    aim();
    window.addEventListener("resize", aim);
    return () => window.removeEventListener("resize", aim);
  }, [open]);

  // It stays fixed under the top bar: its top edge on the breadcrumb bar's top line, its right
  // edge on the content's, like every panel opened from the top bar (lib/layout/topbar-line.ts).
  const panel = open ? (
    <div
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-label={t("title")}
      className={cn(
        "nesto-popup-glass fixed z-50 flex flex-col border border-line bg-surface shadow-lg rounded-[14px] shadow-menu",
        "right-[max(0.75rem,env(safe-area-inset-right))] top-[var(--nesto-shell-header-h)] max-h-[calc(100dvh-var(--nesto-shell-header-h)-1.5rem)] w-[min(26rem,calc(100vw-1.5rem))] touch:mt-3 md:right-[max(1.5rem,env(safe-area-inset-right))] xl:right-8",
      )}
      data-testid="activity-panel"
    >
      <PanelPointer side="above" />
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
  ) : null;

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
        className="relative grid size-10 shrink-0 place-items-center rounded-none text-fg-muted transition-colors hover:bg-hover hover:text-fg aria-expanded:bg-hover touch:size-11"
        data-testid="notification-bell"
        data-count-state={counts === null ? "unknown" : snapshot.count.stale ? "stale" : "fresh"}
        {...warm}
      >
        <span className="relative">
          <Bell aria-hidden="true" className="size-[18px]" />
        </span>
        {total > 0 ? (
          <span aria-hidden="true" data-testid="notification-badge" className={cn("absolute right-1 top-1 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold leading-4 max-md:text-micro ring-2 ring-canvas", critical ? "bg-danger text-danger-fg" : "bg-accent text-accent-fg", snapshot.count.stale && "opacity-70")}>
            {total > 99 ? "99+" : total}
          </span>
        ) : null}
      </button>

      {panel}
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
    // Pull to refresh (or Refresh in the More sheet) reads the page again: the bell reads its feed again too.
    const unrefresh = onDataRefresh(() => controller.changed());
    const unreset = onActivityReset(() => controller.reset());
    return () => {
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      unsubscribe();
      unrefresh();
      unreset();
      controller.stop();
    };
  }, [controller]);

  return controller;
}
