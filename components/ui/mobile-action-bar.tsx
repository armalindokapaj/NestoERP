"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useIsBelow } from "@/components/ui/use-breakpoint";
import { keyboardInset } from "@/lib/ui/gestures";
import { cn } from "@/lib/utils/cn";

/**
 * The phone's bottom action bar (mobile audit 5b). One component, two places:
 *
 * - `MobileActionBar` — a form's Save / Cancel (RecordForm, through
 *   `StickyActions`). Below `md` it sticks to the bottom of the screen, above
 *   the bottom navigation, and stays part of the form: at the form's end it
 *   sits under the last field. From `md` it is the form's footer row, drawn
 *   exactly as before.
 * - `MainAction` — a detail page's main action (Complete, Approve / Reject,
 *   Submit …), wrapped where the page's header actions draw it. Below `md` it
 *   is moved into the shell's one pinned bar (`MobileActionBarHost`), above
 *   the bottom navigation; from `md` it stays in the header, where it always
 *   was. Several `MainAction`s on a page share the one bar. Secondary actions
 *   are not wrapped: they stay in the page's ⋯ (components/navigation/page-menu.tsx).
 *
 * Both are marked `data-mobile-action-bar` ("flow" or "pinned"), which is what
 * styles/globals.css reads: the page keeps room for a pinned bar at its foot,
 * focus scrolling and toasts keep clear of either, and both sit above the
 * bottom navigation, or the keyboard when one is open. On Android the layout
 * viewport shrinks with the keyboard (app/layout.tsx, MOB-01), so a bar at the
 * bottom is already above it; iOS overlays the keyboard, and the bar is lifted
 * by `--nesto-keyboard-inset`, which this module publishes from the visual
 * viewport while a bar is mounted. While a text field has focus the pinned
 * bar steps aside, as the bottom navigation does; a form's Save stays.
 */

type HostRegistry = { host: HTMLElement | null; setHost: (node: HTMLElement | null) => void };

const HostContext = React.createContext<HostRegistry | null>(null);

/** Mounted once by the app shell, around the page and the host. */
export function MobileActionBarProvider({ children }: { children: React.ReactNode }) {
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const value = React.useMemo(() => ({ host, setHost }), [host]);
  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

/** The look of the bar on a phone: a floating slab like the bottom navigation under it. */
const PHONE_SLAB = "rounded-[20px] border border-line bg-surface/90 p-2 shadow-menu backdrop-blur-xl";

/**
 * The shell's pinned bar, where `MainAction`s go below `md`. Nothing at all
 * while it holds nothing (`empty:hidden`), and never from `md`.
 */
export function MobileActionBarHost() {
  const registry = React.useContext(HostContext);
  const t = useTranslations("ui");
  const setHost = registry?.setHost;
  const [node, setNode] = React.useState<HTMLDivElement | null>(null);
  const ref = React.useCallback(
    (element: HTMLDivElement | null) => {
      setNode(element);
      setHost?.(element);
    },
    [setHost],
  );
  useBarGeometry(node);
  return (
    <div
      ref={ref}
      role="group"
      aria-label={t("pageActions")}
      data-mobile-action-bar="pinned"
      data-testid="mobile-action-bar"
      className={cn(
        "fixed bottom-(--nesto-action-bar-bottom) left-[max(0.75rem,var(--nesto-safe-left))] right-[max(0.75rem,var(--nesto-safe-right))] z-(--nesto-z-shell-tabs) mx-auto flex max-w-xl flex-wrap items-center gap-2 empty:hidden md:hidden",
        PHONE_SLAB,
        // Each action takes an equal share of the bar; two or three fit a phone side by side.
        "[&>*]:min-w-0 [&>*]:flex-1",
      )}
    />
  );
}

/**
 * A detail page's main action. From `md` it is drawn where it sits (the
 * wrapper has no box of its own); below `md` it moves into the shell's pinned
 * bar. Until the page has hydrated it is hidden below `md` rather than drawn
 * in the header first and then moved. Outside the shell it simply stays where
 * it is at every width.
 */
export function MainAction({ children }: { children: React.ReactNode }) {
  const registry = React.useContext(HostContext);
  const phone = useIsBelow("md");
  if (registry && phone === true && registry.host) return createPortal(children, registry.host);
  return (
    <div
      data-main-action=""
      // In a header row that holds the page's ⋯ (below lg) its actions follow the ⋯, as their siblings do: a rule in styles/globals.css.
      className={cn("contents", registry && "max-md:hidden")}
    >
      {children}
    </div>
  );
}

/**
 * A form's action row: sticky above the bottom navigation on a phone, the
 * plain footer row from `md`. `className` is for the row from `md` (its
 * alignment); the phone's slab is the same everywhere.
 */
export function MobileActionBar({ className, children, ...props }: React.ComponentProps<"div">) {
  const [node, setNode] = React.useState<HTMLDivElement | null>(null);
  useBarGeometry(node);
  return (
    <div
      ref={setNode}
      data-mobile-action-bar="flow"
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 md:py-3",
        // Above the bottom navigation, and above a page's pinned bar if it has one too.
        "max-md:sticky max-md:bottom-[calc(var(--nesto-action-bar-bottom)+var(--nesto-action-bar-room))] max-md:z-(--nesto-z-shell-tabs)",
        "max-md:rounded-[20px] max-md:border max-md:border-line max-md:bg-surface/90 max-md:p-2 max-md:shadow-menu max-md:backdrop-blur-xl",
        // Save and Cancel share the bar; an empty unsaved note takes no room.
        "max-md:[&>button]:min-w-0 max-md:[&>button]:flex-1 max-md:[&>a]:flex-1 max-md:[&>span:empty]:hidden",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

/** The heights of the bars on screen; the tallest is published, so the page keeps room for it. */
const heights = new Map<HTMLElement, number>();

function publishHeight() {
  const root = document.documentElement;
  const tallest = Math.max(0, ...heights.values());
  if (tallest > 0) root.style.setProperty("--nesto-action-bar-h", `${Math.ceil(tallest)}px`);
  else root.style.removeProperty("--nesto-action-bar-h");
}

/** How many bars are mounted: the keyboard is followed while there is at least one. */
let keyboardUsers = 0;
let stopKeyboard: (() => void) | null = null;

const TEXT_TYPES = new Set(["text", "email", "search", "tel", "url", "password", "number", ""]);

function isTextField(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return TEXT_TYPES.has(element.getAttribute("type") ?? "");
  return element instanceof HTMLElement && element.isContentEditable;
}

function followKeyboard(): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => undefined;
  const root = document.documentElement;
  let frame = 0;
  const apply = () => {
    frame = 0;
    const inset = isTextField(document.activeElement) ? keyboardInset(window.innerHeight, viewport) : 0;
    if (inset > 0) root.style.setProperty("--nesto-keyboard-inset", `${inset}px`);
    else root.style.removeProperty("--nesto-keyboard-inset");
  };
  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(apply);
  };
  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  document.addEventListener("focusin", schedule);
  document.addEventListener("focusout", schedule);
  apply();
  return () => {
    if (frame) window.cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
    document.removeEventListener("focusin", schedule);
    document.removeEventListener("focusout", schedule);
    root.style.removeProperty("--nesto-keyboard-inset");
  };
}

/** Measures a bar while it is mounted and keeps the keyboard inset current; both are withdrawn when it goes. */
function useBarGeometry(node: HTMLElement | null) {
  React.useEffect(() => {
    if (!node) return;
    keyboardUsers += 1;
    if (keyboardUsers === 1) stopKeyboard = followKeyboard();
    const measure = () => {
      heights.set(node, node.getBoundingClientRect().height);
      publishHeight();
    };
    measure();
    // One observer per bar, released on unmount: bounded, not global. A bar that is not drawn measures 0.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      heights.delete(node);
      publishHeight();
      keyboardUsers -= 1;
      if (keyboardUsers === 0) {
        stopKeyboard?.();
        stopKeyboard = null;
      }
    };
  }, [node]);
}
