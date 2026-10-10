"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Bell, X } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { createActivityController, fetchTransport, type ActivityController } from "@/lib/activity/activity-controller";
import { onActivityReset, removeLegacyActivityCache, subscribeActivity } from "@/lib/activity/client";
import { createPanelLoader, usePanelModule, usePanelOpen, useWarmIntent } from "@/lib/navigation/panel-host";
import { usePhone } from "@/components/layout/use-phone";
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
 * `placement="bar"` is the phone's bottom bar cell (icon over label). The bell
 * lives in the top bar from tablet up and in the bar on a phone; once the width
 * is known only the one that belongs is mounted, so there is one controller and
 * one `notification-bell`.
 */
export function ActivityBell({ contextKey, canManageAnnouncements = false, placement = "topbar" }: { contextKey: string; canManageAnnouncements?: boolean; placement?: "topbar" | "bar" }) {
  const phone = usePhone();
  if (phone === true && placement === "topbar") return null;
  if (phone === false && placement === "bar") return null;
  return <BellControl contextKey={contextKey} canManageAnnouncements={canManageAnnouncements} placement={placement} />;
}

function BellControl({ contextKey, canManageAnnouncements, placement }: { contextKey: string; canManageAnnouncements: boolean; placement: "topbar" | "bar" }) {
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

  const inBar = placement === "bar";

  // On a touch layout the panel carries a pointer: it is aimed at the bell.
  React.useLayoutEffect(() => {
    if (!open) return;
    const aim = () => aimPointer(panelRef.current, triggerRef.current);
    aim();
    window.addEventListener("resize", aim);
    return () => window.removeEventListener("resize", aim);
  }, [open]);

  // In the top bar it stays fixed under the bar: its top edge on the breadcrumb bar's top line, its right
  // edge on the content's, like every panel opened from the top bar (lib/layout/topbar-line.ts).
  // In the phone's bottom bar it is a bubble of glass floating above the bar, its pointer on the bell.
  const panel = open ? (
    <div
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-label={t("title")}
      className={cn(
        "nesto-popup-glass fixed z-50 flex flex-col rounded-lg border border-line bg-surface shadow-lg",
        inBar
          ? "inset-x-3 bottom-[calc(var(--nesto-safe-bottom)+6.5rem)] mx-auto max-h-[min(70dvh,calc(100dvh-10rem))] max-w-md"
          : "right-[max(1.5rem,env(safe-area-inset-right))] top-[var(--nesto-shell-header-h)] max-h-[calc(100dvh-var(--nesto-shell-header-h)-1.5rem)] w-[min(26rem,calc(100vw-1.5rem))] touch:mt-3 xl:right-8",
      )}
      data-testid="activity-panel"
      data-placement={placement}
    >
      <PanelPointer side={inBar ? "below" : "above"} />
      {Body ? (
        <Body controller={controller} snapshot={snapshot} panelId={panelId} canManageAnnouncements={canManageAnnouncements} onClose={close} viewAllLabel={inBar ? t("allAlerts") : undefined} />
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
    <div className={cn("relative", inBar && "min-w-0 flex-1")}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        className={cn(
          "relative shrink-0 text-fg-muted transition-colors hover:text-fg",
          inBar
            ? "flex h-14 w-full flex-col items-center justify-center gap-0.5 px-1 text-micro font-semibold leading-tight text-fg-subtle aria-expanded:text-accent-strong"
            : "grid size-9 place-items-center rounded-md hover:bg-hover aria-expanded:bg-hover touch:size-11",
        )}
        data-testid="notification-bell"
        data-count-state={counts === null ? "unknown" : snapshot.count.stale ? "stale" : "fresh"}
        {...warm}
      >
        <span className="relative">
          <Bell aria-hidden="true" className={inBar ? "size-[22px]" : "size-[18px]"} strokeWidth={1.6} />
          {total > 0 && inBar ? (
            <span aria-hidden="true" data-testid="notification-badge" className={cn("absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold leading-4 ring-2 ring-surface", critical ? "bg-danger text-danger-fg" : "bg-accent text-accent-fg", snapshot.count.stale && "opacity-70")}>
              {total > 99 ? "99+" : total}
            </span>
          ) : null}
        </span>
        {inBar ? <span className="max-w-full truncate tracking-tight">{t("barLabel")}</span> : null}
        {total > 0 && !inBar ? (
          <span aria-hidden="true" data-testid="notification-badge" className={cn("absolute right-1 top-1 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold leading-4 ring-2 ring-canvas", critical ? "bg-danger text-danger-fg" : "bg-accent text-accent-fg", snapshot.count.stale && "opacity-70")}>
            {total > 99 ? "99+" : total}
          </span>
        ) : null}
      </button>

      {inBar && panel ? createPortal(panel, document.body) : panel}
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
