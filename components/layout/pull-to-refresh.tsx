"use client";

import * as React from "react";
import { ArrowDown, Loader2 } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useRouter } from "@/components/navigation/guarded-router";
import { announce } from "@/lib/a11y/announcer";
import { isNativePlatform } from "@/lib/device/platform";
import { activeOverlay } from "@/lib/navigation/panel-host";
import { announceDataRefresh, REQUEST_REFRESH_EVENT } from "@/lib/navigation/refresh-event";
import { lockAxis, pullDistance, pullProgress, PULL_THRESHOLD } from "@/lib/ui/gestures";
import { unsaved } from "@/lib/unsaved/coordinator";
import { cn } from "@/lib/utils/cn";

/**
 * Pull to refresh, the shell's own (mobile audit 5c). Mounted once by the app
 * shell.
 *
 * On a phone (below `md`) — and in the native shell below `lg`, where there is
 * no browser reload at all (`lib/device`) — pulling down from the very top of
 * the page shows an indicator under the top bar; letting go once it has
 * travelled far enough reads the page again in place: `router.refresh()`
 * re-renders its server components, and `REFRESH_DATA_EVENT`
 * (lib/navigation/refresh-event.ts) tells the lists a client component holds
 * to read themselves again. Nothing is reloaded and nothing typed is lost. The
 * browser's own pull to refresh is turned off there (globals.css).
 *
 * It never starts:
 * - unless the page is scrolled to its top and the pull is down and along the
 *   page (axis-locked, so a sideways swipe stays a swipe);
 * - over a dialog, drawer, sheet, menu or popover, or a top-bar panel;
 * - inside a horizontal scroller, an inner scroller that is not at its top, or
 *   anything that keeps the finger for itself — a map, a 3D view, a canvas,
 *   the timesheet grid (`data-no-pull-refresh`, or `touch-action` without
 *   vertical panning);
 * - while a text field has focus, or while anything on the page holds unsaved
 *   work (AUD-03): reading the page again is never a way to lose an edit.
 *
 * Reduced motion: the indicator fades in where it will wait instead of
 * following the finger, and does not spin.
 *
 * Not the only way: Refresh in the More sheet asks for the same refresh
 * (`requestPageRefresh`), and the browser's reload still works.
 */

const PHONE = "(max-width: 767.98px)";
const BELOW_LG = "(max-width: 1023.98px)";
const REDUCED = "(prefers-reduced-motion: reduce)";
/** The indicator's diameter; it starts this far up, hidden under the top bar. */
const SIZE = 40;
/** Where the indicator waits while the page is read. */
const HOLD = Math.round(PULL_THRESHOLD * 0.8);
/** A refresh shows at least this long, so a fast one is still seen to happen. */
const MIN_SHOWN_MS = 450;

const OVERLAYS = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [data-radix-popper-content-wrapper]';
const NO_PULL = '[data-no-pull-refresh], canvas, video, iframe, input[type="range"], [contenteditable=""], [contenteditable="true"]';

function enabled(): boolean {
  if (window.matchMedia(PHONE).matches) return true;
  return isNativePlatform() && window.matchMedia(BELOW_LG).matches;
}

const reducedMotion = () => window.matchMedia(REDUCED).matches;

function scrollTop(): number {
  return Math.max(window.scrollY, document.scrollingElement?.scrollTop ?? 0);
}

function typing(): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement) return true;
  if (active instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "reset", "range", "file", "color"].includes(active.type);
  return active instanceof HTMLElement && active.isContentEditable;
}

/** Whether anything is open over the page. */
function overlayOpen(): boolean {
  if (activeOverlay() !== null || document.body.hasAttribute("data-scroll-locked")) return true;
  for (const node of document.querySelectorAll(OVERLAYS)) {
    if (node.getClientRects().length > 0) return true;
  }
  return false;
}

/**
 * Whether a pull may begin where the finger came down: not on anything that
 * keeps the finger for itself, not inside a horizontal scroller, and not in a
 * vertical one that still has somewhere to scroll up to.
 */
export function pullAllowedFrom(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest(NO_PULL) || target.closest(OVERLAYS)) return false;
  for (let node: Element | null = target; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    const touch = style.touchAction;
    if (touch && touch !== "auto" && touch !== "manipulation" && !touch.includes("pan-y")) return false;
    const y = style.overflowY;
    if ((y === "auto" || y === "scroll" || y === "overlay") && node.scrollHeight > node.clientHeight + 1 && node.scrollTop > 0) return false;
    const x = style.overflowX;
    if ((x === "auto" || x === "scroll" || x === "overlay") && node.scrollWidth > node.clientWidth + 1) return false;
  }
  return true;
}

type Track = { x: number; y: number; axis: "x" | "y" | null; distance: number };

export function PullToRefresh() {
  const router = useRouter();
  const t = useTranslations("ui");
  const [pending, startTransition] = React.useTransition();
  const [phase, setPhase] = React.useState<"idle" | "pulling" | "refreshing">("idle");
  const [armed, setArmed] = React.useState(false);
  const indicator = React.useRef<HTMLDivElement>(null);
  const arrow = React.useRef<HTMLSpanElement>(null);
  const track = React.useRef<Track | null>(null);
  const busy = React.useRef(false);
  const startedAt = React.useRef(0);
  const latest = React.useRef({ router, t });
  latest.current = { router, t };

  /** Draws the indicator `distance` pixels down; `animate` eases it there (never under reduced motion). */
  const paint = React.useCallback((distance: number, animate: boolean) => {
    const node = indicator.current;
    if (!node) return;
    const reduce = reducedMotion();
    const progress = pullProgress(distance);
    node.style.transition = animate && !reduce ? "transform 200ms var(--nesto-ease), opacity 200ms var(--nesto-ease)" : "none";
    const y = reduce ? (distance > 0 ? HOLD - SIZE : -SIZE) : distance - SIZE;
    node.style.transform = `translate(-50%, ${y}px)`;
    node.style.opacity = distance > 0 ? String(reduce ? 0.35 + 0.65 * progress : Math.min(1, progress * 1.4)) : "0";
    if (arrow.current) arrow.current.style.transform = reduce ? "" : `rotate(${Math.round(progress * 180)}deg)`;
  }, []);

  const refresh = React.useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    startedAt.current = Date.now();
    track.current = null;
    setArmed(false);
    setPhase("refreshing");
    paint(HOLD, true);
    announce(latest.current.t("refreshing"));
    announceDataRefresh();
    startTransition(() => latest.current.router.refresh());
  }, [paint]);

  // The gesture: one set of passive listeners for the document's life, doing nothing until a pull qualifies.
  React.useEffect(() => {
    const reset = () => {
      track.current = null;
      // A refresh under way keeps its indicator until it is done.
      if (busy.current) return;
      setArmed(false);
      setPhase((current) => (current === "pulling" ? "idle" : current));
      paint(0, true);
    };
    const onStart = (event: TouchEvent) => {
      track.current = null;
      if (busy.current || event.touches.length !== 1 || !enabled()) return;
      if (scrollTop() > 0 || typing() || overlayOpen() || !pullAllowedFrom(event.target)) return;
      const viewport = window.visualViewport;
      // Zoomed in, the finger is moving the visual viewport, not asking for anything.
      if (viewport && (Math.abs(viewport.scale - 1) > 0.01 || viewport.offsetTop > 0)) return;
      if (unsaved.hasBlocking({ kind: "reload" })) return;
      const touch = event.touches.item(0);
      if (!touch) return;
      track.current = { x: touch.clientX, y: touch.clientY, axis: null, distance: 0 };
    };
    const onMove = (event: TouchEvent) => {
      const current = track.current;
      if (!current) return;
      if (event.touches.length !== 1) {
        reset();
        return;
      }
      const touch = event.touches.item(0);
      if (!touch) return;
      const dx = touch.clientX - current.x;
      const dy = touch.clientY - current.y;
      if (current.axis === null) {
        const axis = lockAxis(dx, dy);
        if (axis === null) return;
        if (axis === "x" || dy < 0 || scrollTop() > 0) {
          track.current = null;
          return;
        }
        current.axis = "y";
        setPhase("pulling");
      }
      current.distance = pullDistance(dy);
      setArmed(current.distance >= PULL_THRESHOLD);
      paint(current.distance, false);
    };
    const onEnd = () => {
      const current = track.current;
      track.current = null;
      if (!current || current.axis !== "y") return;
      if (current.distance >= PULL_THRESHOLD && !busy.current) refresh();
      else reset();
    };
    const options: AddEventListenerOptions = { passive: true };
    document.addEventListener("touchstart", onStart, options);
    document.addEventListener("touchmove", onMove, options);
    document.addEventListener("touchend", onEnd, options);
    document.addEventListener("touchcancel", reset, options);
    window.addEventListener(REQUEST_REFRESH_EVENT, refresh);
    return () => {
      document.removeEventListener("touchstart", onStart, options);
      document.removeEventListener("touchmove", onMove, options);
      document.removeEventListener("touchend", onEnd, options);
      document.removeEventListener("touchcancel", reset, options);
      window.removeEventListener(REQUEST_REFRESH_EVENT, refresh);
    };
  }, [paint, refresh]);

  // The native shell's tablets have the gesture too: the browser's own pull is turned off there as well (globals.css).
  React.useEffect(() => {
    if (!isNativePlatform()) return;
    const root = document.documentElement;
    root.setAttribute("data-pull-refresh", "");
    return () => root.removeAttribute("data-pull-refresh");
  }, []);

  // Done once the refreshed page has rendered, and not sooner than MIN_SHOWN_MS after it began.
  React.useEffect(() => {
    if (phase !== "refreshing" || pending) return;
    const wait = Math.max(0, MIN_SHOWN_MS - (Date.now() - startedAt.current));
    const timer = window.setTimeout(() => {
      busy.current = false;
      paint(0, true);
      setPhase("idle");
      announce(latest.current.t("pageUpdated"));
    }, wait);
    return () => window.clearTimeout(timer);
  }, [phase, pending, paint]);

  return (
    <div
      ref={indicator}
      aria-hidden="true"
      data-pull-indicator={phase}
      data-armed={armed || undefined}
      className={cn(
        "pointer-events-none fixed left-1/2 top-(--nesto-sticky-stack) z-[29] grid size-10 place-items-center rounded-full border border-line bg-surface text-fg-muted opacity-0 shadow-menu lg:hidden print:hidden",
        "data-armed:border-accent/40 data-armed:text-accent-strong",
      )}
      style={{ transform: `translate(-50%, ${-SIZE}px)` }}
    >
      {phase === "refreshing" ? (
        <Loader2 className="size-5 animate-spin text-accent-strong motion-reduce:animate-none" />
      ) : (
        <span ref={arrow} className="grid place-items-center">
          <ArrowDown className="size-5" />
        </span>
      )}
    </div>
  );
}
