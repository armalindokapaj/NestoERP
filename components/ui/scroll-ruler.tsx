"use client";

import * as React from "react";
import { createPortal, flushSync } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, List } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { usePageSections, type UiSection } from "@/components/ui/page-sections";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  RETURN_HOLD_MS,
  RETURN_WAIT_MS,
  RULER_MIN_WIDTH,
  activeSection,
  anchorTarget,
  clusterMarkers,
  displayPercent,
  keyboardTarget,
  labelPanelFits,
  markerY,
  maxScroll,
  progress,
  progressAt,
  readingAnchor,
  resolveActive,
  returnStep,
  rulerMode,
  rulerTicks,
  sectionMarker,
  sectionTarget,
  type MarkerCluster,
  type RulerMode,
  type SectionAnchor,
} from "@/lib/ui/ruler-math";
import { isPlaceAnchor } from "@/lib/navigation/scroll-memory";
import { claimReturns, recallReturn, rememberReturn, returnKey, takeTraversal } from "@/lib/ui/section-return";
import { cn } from "@/lib/utils/cn";

/**
 * The Architectural Scroll Ruler (UI-02 §8).
 *
 * A measuring scale down the right edge of a long, finite page: where the page
 * is scrolled to, and its sections as places to go. It measures the page and
 * nothing else — not a building, not progress on the work (§8.1).
 *
 * It is an enhancement of the page's own scrolling, never a replacement. The
 * wheel, the keyboard and the native scrollbar are untouched; the rail sits
 * inside that scrollbar, in 44px the page keeps clear for it
 * (styles/tokens-v2.css), so it covers no content and showing or hiding it
 * moves nothing. Where the rail does not apply — a narrower window, a touch
 * device, a page under 1.5 viewports, the preference turned off — the same
 * section links are a compact "On this page" disclosure at the top of the
 * page. A page that does not scroll, or has fewer than three sections, shows
 * neither. The decisions are lib/ui/ruler-math.ts; this file measures and paints.
 *
 * What hover and focus show depends on the room beside the rail (§8.2). Over
 * an empty gutter at least 160px wide — a very wide window — it is the panel
 * of section labels. Anywhere else the content runs up to the rail, and a
 * panel would cover it: there it is one compact label, for the section being
 * read, beside the marker. The full list is always one press away, in a
 * popover from the "On this page" control at the head of the rail.
 *
 * One passive scroll listener, batched into an animation frame; a
 * ResizeObserver for the page's extent; the marker moved by a transform. No
 * layout is read while scrolling (§8.6, §8.7).
 *
 * It also brings a reader back (§8.6): a page left part-way down is returned
 * to, by Back or Forward, at the section that was being read and the distance
 * into it — whatever the rail shows, and on any page with a section
 * (lib/ui/section-return.ts).
 */

/** Room above the 0 tick and below the 100 tick: the endpoint figures, and half the marker's 44px hit area. */
const RAIL_PAD = 40;
/** Below this much travel eight labels cannot be told apart: the one active label instead of the panel, gutter or not (§8.2). */
const COMPACT_TRAVEL = 200;
/** A section jump is smooth for at most 200ms; this leaves a frame to spare (§8.4). */
const JUMP_MS = 180;
/** A frame that would end later than this past the 180 is not waited for: a slow display finishes one frame early instead. */
const JUMP_GRACE_MS = 8;
/** How long the pointer rests on the rail before its labels show. */
const HOVER_INTENT_MS = 120;
/** The "On this page" control at the head of the rail: 44 by 24, in the room above the 0 tick. */
const CONTROL_HEIGHT = 24;
/** §9.2: a tooltip waits 400ms before it opens. */
const TOOLTIP_OPEN_MS = 400;

const DESKTOP_QUERY = `(min-width: ${RULER_MIN_WIDTH}px) and (pointer: fine)`;
/** A modal dialog, drawer or sheet: Radix locks the page behind it. A popover is a dialog too, but placed, not blocking. */
const BLOCKING = '[role="dialog"][data-state="open"]:not([data-radix-popper-content-wrapper] *), [role="alertdialog"][data-state="open"]';

type Geometry = {
  max: number;
  /** The sticky stack that covers the top of the viewport. */
  sticky: number;
  /** The viewport height left between the sticky stack and any bottom bar. */
  viewport: number;
  /** The rail's usable travel, 0 percent to 100. */
  travel: number;
  ids: string[];
  offsets: number[];
  targets: number[];
};

type View = {
  mode: RulerMode;
  travel: number;
  clusters: MarkerCluster[];
  /** An empty gutter beside the rail, wide enough for the label panel (§8.2). */
  roomy: boolean;
  key: string;
};

/** A return in progress: the place to go back to, where the page was last seen, and when to stop trying (§8.6). */
type Returning = { anchor: SectionAnchor; expected: number | null; landed: boolean; deadline: number };

const NO_SECTIONS: UiSection[] = [];
const NO_GEOMETRY: Geometry = { max: 0, sticky: 0, viewport: 0, travel: 0, ids: [], offsets: [], targets: [] };
const NO_VIEW: View = { mode: "none", travel: 0, clusters: [], roomy: false, key: "none" };

const unavailable = (section: UiSection) => section.availability === "unavailable";

/** What stands for a section on the page: its heading, or its anchor while the heading is not laid out. */
function sectionNode(section: UiSection): HTMLElement | null {
  return section.element?.isConnected && section.element.getClientRects().length > 0 ? section.element : section.anchor;
}

function outerHeight(element: HTMLElement): number {
  const style = window.getComputedStyle(element);
  return element.offsetHeight + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
}

/** Focus for a heading, which is not otherwise focusable; it stops being so when focus leaves (§8.5). */
function focusHeading(element: HTMLElement | null) {
  if (!element) return;
  if (!element.hasAttribute("tabindex")) {
    element.setAttribute("tabindex", "-1");
    element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true });
  }
  element.focus({ preventScroll: true });
}

/** The scale. Decoration: the scrollbar's value says the same thing to assistive technology (§8.2). */
const Ticks = React.memo(function Ticks({ travel }: { travel: number }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      {rulerTicks(travel).map((tick) => (
        <span
          key={tick.percent}
          style={{ top: RAIL_PAD + Math.round((travel * tick.percent) / 100) }}
          className={cn("absolute right-[7px] h-px bg-current forced-colors:bg-[CanvasText]", tick.major ? "w-3.5" : "w-[7px]")}
        />
      ))}
      {/* Figures on the scale are in the monospace companion, like the section ordinals (§6.2). */}
      <span className="absolute right-[7px] font-mono text-tick tabular-nums text-fg-subtle" style={{ top: CONTROL_HEIGHT }}>0</span>
      <span className="absolute right-[7px] font-mono text-tick tabular-nums text-fg-subtle" style={{ top: RAIL_PAD + travel + 8 }}>100</span>
    </span>
  );
});

/**
 * The one label there is room for where the page's content runs up to the rail: the section being read,
 * beside the marker (§8.2). It says nothing a link does not, so it is for the eye only.
 */
export function RulerSectionLabel({ label, className }: { label: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="scroll-ruler-label"
      className={cn(
        "pointer-events-none flex h-6 w-max max-w-40 items-center rounded-sm border border-line bg-surface px-2 text-meta font-semibold text-fg shadow-menu",
        className,
      )}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Every section, in page order, each with its own link: the list behind the rail's control and the compact disclosure. */
export function RulerSectionList({
  id,
  sections,
  active,
  onActivate,
  className,
}: {
  id: string;
  sections: UiSection[];
  active: number;
  onActivate: (event: React.MouseEvent<HTMLAnchorElement>, index: number) => void;
  className?: string;
}) {
  return (
    <ol id={id} className={className}>
      {sections.map((section, index) => (
        <li key={section.id}>
          <a
            href={`#${section.id}`}
            aria-current={index === active ? "location" : undefined}
            onClick={(event) => onActivate(event, index)}
            className={cn(
              "flex gap-2 rounded-sm px-3 py-1.5 text-table transition-colors hover:bg-hover touch:min-h-11 touch:items-center touch:text-body",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              index === active ? "font-semibold text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {/* The ordinal is the visible order; the anchor is not (§17.2, §26.3). */}
            <span aria-hidden="true" className="shrink-0 font-mono tabular-nums text-fg-subtle">{String(index + 1).padStart(2, "0")}</span>
            <span className="min-w-0 break-words">{section.label}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

export function ScrollRuler({ children }: { children: React.ReactNode }) {
  const contract = usePageSections();
  const registered = contract?.registeredSections ?? NO_SECTIONS;
  // A section the page holds back — registered, but with nothing to show this reader — is no place to go (§26.3).
  const sections = React.useMemo(() => (registered.some(unavailable) ? registered.filter((section) => !unavailable(section)) : registered), [registered]);
  const regionId = contract?.scrollRegionId ?? "nesto-main";
  const linksSlot = contract?.linksSlot ?? null;
  const t = useTranslations("ui");
  const pathname = usePathname();
  // The page's address without its hash: what a return is remembered under (§8.6).
  const address = returnKey(pathname, useSearchParams().toString());
  const listId = React.useId();

  const frame = React.useRef<HTMLDivElement>(null);
  const lane = React.useRef<HTMLDivElement>(null);
  const rail = React.useRef<HTMLDivElement>(null);
  const marker = React.useRef<HTMLDivElement>(null);
  const readout = React.useRef<HTMLSpanElement>(null);
  const panel = React.useRef<HTMLElement>(null);
  const list = React.useRef<HTMLElement>(null);
  const links = React.useRef<HTMLElement>(null);
  const linksToggle = React.useRef<HTMLButtonElement>(null);

  const geometry = React.useRef<Geometry>(NO_GEOMETRY);
  const shown = React.useRef<RulerMode>("none");
  /** The section last activated by hand: it wins among sections the scroll position cannot tell apart, until the page moves on. */
  const chosen = React.useRef<string | null>(null);
  const sync = React.useRef<() => void>(() => undefined);
  /** A section jump in flight: its animation frame, and whether it is still on its way. */
  const motion = React.useRef(0);
  const jumping = React.useRef(false);
  const hoverIntent = React.useRef(0);
  /** A drag in hand. `top` is the rail's place in the viewport, read once: the rail is fixed, so it holds for the drag (§8.7). */
  const drag = React.useRef<{ pointer: number; grab: number; from: number; top: number } | null>(null);
  const railHadFocus = React.useRef(false);
  /** What opened the list, when it was not the rail's own control: focus goes back to it. */
  const opener = React.useRef<HTMLElement | null>(null);
  /** The list closed onto a heading that already has focus: it is not taken back to the control. */
  const headed = React.useRef(false);
  /** Whether the last press was a key. Enter on a link is a click like any other, and only some browsers say which it was. */
  const keyed = React.useRef(false);
  /** Where the page was when it was last painted; `null` until it has been. What a return is remembered from. */
  const seen = React.useRef<number | null>(null);
  const returning = React.useRef<Returning | null>(null);

  // The rail is portalled to <body>, which the server cannot render into.
  const [mounted, setMounted] = React.useState(false);
  const [view, setView] = React.useState<View>(NO_VIEW);
  const [active, setActive] = React.useState(0);
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const [listOpen, setListOpen] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [linksOpen, setLinksOpen] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  /*
   * Coming back (§8.6). Every page opens at its top, and stays there unless
   * this arrival was Back or Forward to an address that was left part-way
   * down: then the page goes to that section, and the distance into it, once
   * the section has been measured (`measure`, below). Declared before the
   * effect that measures, so a return is in hand at the first measurement.
   */
  React.useEffect(() => {
    const anchor = recallReturn(address);
    // A place kept from the page's rows, before this ruler was on it, is not a section: that return is not this one's.
    if (anchor && isPlaceAnchor(anchor.id)) return;
    if (!takeTraversal(address)) return;
    if (anchor) returning.current = { anchor, expected: null, landed: false, deadline: performance.now() + RETURN_WAIT_MS };
  }, [address]);

  // While this ruler is mounted the page's place is kept here, by section, and nowhere else (lib/ui/section-return.ts).
  React.useLayoutEffect(() => claimReturns(address), [address]);

  /*
   * Leaving. The place is taken from what was last painted, not read from the
   * page now: by the time a route change reaches this cleanup the window may
   * already be back at its top. A page left at its top is forgotten, and one
   * that was never painted remembers nothing.
   */
  React.useLayoutEffect(() => {
    const leave = () => {
      const top = seen.current;
      if (top === null) return;
      const { ids, offsets, sticky } = geometry.current;
      rememberReturn(address, top < 1 ? null : readingAnchor(ids, offsets, top, sticky));
    };
    // A reload, another site, the tab closing: no cleanup runs for those.
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [address]);

  /*
   * Measure and paint. `measure` reads layout — the page's extent, the sticky
   * stack, each heading — and runs only when something that could move them
   * changed. `paint` runs once per scrolled frame and reads only `scrollTop`.
   */
  React.useEffect(() => {
    if (!mounted) return;
    const html = document.documentElement;
    const root = document.scrollingElement ?? html;
    const region = document.getElementById(regionId);
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const ids = sections.map((section) => section.id);
    let live = true;
    let frameId = 0;
    let stale = true;
    let painted: { rail: HTMLElement | null; percent: number; active: number } = { rail: null, percent: -1, active: -1 };

    const measure = () => {
      const box = frame.current?.getBoundingClientRect();
      const sticky = box?.top ?? 0;
      const viewport = box?.height ?? root.clientHeight;
      const travel = Math.max(0, (lane.current?.offsetHeight ?? viewport) - RAIL_PAD * 2);
      const max = maxScroll(root.scrollHeight, root.clientHeight);
      const top = root.scrollTop;
      const offsets = sections.map((section) => (sectionNode(section)?.getBoundingClientRect().top ?? 0) + top);
      const targets = offsets.map((offset) => sectionTarget(offset, sticky, max));
      geometry.current = { max, sticky, viewport, travel, ids, offsets, targets };

      // The links sit in the page's flow; their own height must not be what makes the page long enough for them.
      const own = links.current ? outerHeight(links.current) : 0;
      const mode = rulerMode({
        enabled: html.dataset.ds === "2",
        preference: html.dataset.ruler === "off" ? "off" : "auto",
        desktop: desktop.matches,
        sections: sections.length,
        maxScroll: maxScroll(root.scrollHeight - own, root.clientHeight),
        contentHeight: root.scrollHeight - own - (root.clientHeight - viewport),
        unobscuredViewport: viewport,
        blocked: document.body.hasAttribute("data-scroll-locked") && document.querySelector(BLOCKING) !== null,
        current: shown.current,
      });
      shown.current = mode;
      const clusters = mode === "rail" ? clusterMarkers(targets.map((target) => sectionMarker(target, max) * travel)) : [];
      // The room beside the rail: from where the page's content ends — its box, less its own padding — to the rail (§8.2).
      const roomy =
        mode === "rail" && box && region
          ? labelPanelFits(region.getBoundingClientRect().right - (parseFloat(window.getComputedStyle(region).paddingRight) || 0), box.left)
          : false;
      const key = `${mode}|${travel}|${roomy}|${clusters.map((cluster) => `${Math.round(cluster.position)}:${cluster.members.join(".")}`).join("|")}`;
      setView((current) => (current.key === key ? current : { mode, travel, clusters, roomy, key }));

      // A return in progress: to the section's place as just measured, unless the reader has moved the page since (§8.6).
      const back = returning.current;
      if (back) {
        const now = performance.now();
        const step = returnStep({ scrollTop: top, expected: back.expected, target: anchorTarget(back.anchor, ids, offsets, sticky, max), now, deadline: back.deadline });
        if (step.action === "stop") returning.current = null;
        else if (step.action === "wait") back.expected = top;
        else {
          if (Math.abs(step.top - top) >= 1) window.scrollTo({ top: step.top, behavior: "instant" });
          back.expected = root.scrollTop;
          if (!back.landed) {
            back.landed = true;
            back.deadline = now + RETURN_HOLD_MS;
          }
        }
      }
    };

    const paint = () => {
      const { max, sticky, travel, offsets, targets } = geometry.current;
      const top = root.scrollTop;
      seen.current = top;
      const value = progress(top, max);
      if (marker.current) marker.current.style.transform = `translate3d(0, ${markerY(value, RAIL_PAD, travel)}px, 0)`;
      // The value changes a hundred times down a page, not once a pixel, and is never announced as it moves (§8.5).
      const percent = displayPercent(value);
      if (rail.current && (painted.percent !== percent || painted.rail !== rail.current)) {
        rail.current.setAttribute("aria-valuenow", String(percent));
        rail.current.setAttribute("aria-valuetext", t("ruler.valueText", { percent }));
        if (readout.current) readout.current.textContent = `${percent}%`;
      }
      const held = chosen.current;
      const index = resolveActive(activeSection(offsets, top, max, sticky), held ? sections.findIndex((section) => section.id === held) : -1, targets);
      // Scrolled on from the section that was chosen: the headings decide again.
      if (held && !jumping.current && sections[index]?.id !== held) chosen.current = null;
      if (index !== painted.active) setActive(index);
      painted = { rail: rail.current, percent, active: index };
    };

    const flush = () => {
      frameId = 0;
      if (stale) {
        stale = false;
        measure();
      }
      paint();
    };
    const schedule = () => {
      if (live && !frameId) frameId = window.requestAnimationFrame(flush);
    };
    const invalidate = () => {
      stale = true;
      schedule();
    };

    // Data arriving, images sizing, a font swapping, an accordion opening: all change the page's extent (§8.6).
    const extent = new ResizeObserver(invalidate);
    extent.observe(document.body);
    if (frame.current) extent.observe(frame.current);
    if (region) extent.observe(region);
    // The version and the preference are followed live on <html>; a modal marks <body>.
    const attributes = new MutationObserver(invalidate);
    attributes.observe(html, { attributes: true, attributeFilter: ["data-ds", "data-ruler"] });
    attributes.observe(document.body, { attributes: true, attributeFilter: ["data-scroll-locked"] });
    desktop.addEventListener("change", invalidate);
    window.addEventListener("resize", invalidate);
    window.addEventListener("scroll", schedule, { passive: true });
    void document.fonts?.ready.then(invalidate);
    sync.current = invalidate;
    invalidate();

    return () => {
      live = false;
      window.cancelAnimationFrame(frameId);
      extent.disconnect();
      attributes.disconnect();
      desktop.removeEventListener("change", invalidate);
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("scroll", schedule);
      sync.current = () => undefined;
    };
  }, [mounted, sections, regionId, t]);

  // What was just mounted — the rail, its panel — is painted before the browser shows it.
  React.useLayoutEffect(() => sync.current(), [view]);

  /**
   * Ends a jump in flight and takes its two listeners off the window. One
   * function for the ruler's life, so a second jump adds nothing and the end of
   * a jump, the next one, a route change and an unmount all remove them (§8.4).
   */
  const settle = React.useCallback(function settle() {
    window.cancelAnimationFrame(motion.current);
    jumping.current = false;
    window.removeEventListener("wheel", settle);
    window.removeEventListener("touchstart", settle);
  }, []);

  /** Scrolls the page: at once, or — a section jump — over at most 200ms, and at once under reduced motion (§8.4). */
  const scrollPage = React.useCallback((top: number, smooth: boolean, done?: () => void) => {
    settle();
    const from = window.scrollY;
    if (!smooth || Math.abs(top - from) < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      window.scrollTo({ top, behavior: "instant" });
      done?.();
      return;
    }
    const started = performance.now();
    let previous = started;
    const step = (now: number) => {
      const run = Math.max(0, now - started);
      // The frames come as fast as the display draws them. If the next one would land past the limit, this one is the last.
      const last = run >= JUMP_MS || run + (now - previous) > JUMP_MS + JUMP_GRACE_MS;
      previous = now;
      const elapsed = last ? 1 : run / JUMP_MS;
      window.scrollTo({ top: from + (top - from) * (1 - (1 - elapsed) ** 3), behavior: "instant" });
      if (!last) {
        motion.current = window.requestAnimationFrame(step);
        return;
      }
      settle();
      done?.();
    };
    jumping.current = true;
    motion.current = window.requestAnimationFrame(step);
    // A person who scrolls during the jump keeps the page: it never fights them.
    window.addEventListener("wheel", settle, { passive: true });
    window.addEventListener("touchstart", settle, { passive: true });
  }, [settle]);

  const endDrag = React.useCallback(
    (revert = false) => {
      const held = drag.current;
      if (!held) return;
      drag.current = null;
      if (rail.current?.hasPointerCapture(held.pointer)) rail.current.releasePointerCapture(held.pointer);
      if (revert) scrollPage(held.from, false);
      setDragging(false);
    },
    [scrollPage],
  );

  // A route change or an unmount ends a drag and a jump in flight (§8.4).
  React.useEffect(
    () => () => {
      endDrag();
      settle();
      window.clearTimeout(hoverIntent.current);
    },
    [pathname, endDrag, settle],
  );

  // Escape cancels a drag and puts the page back where the drag began.
  React.useEffect(() => {
    if (!dragging) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      endDrag(true);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [dragging, endDrag]);

  React.useEffect(() => {
    const onKey = () => {
      keyed.current = true;
    };
    const onPointer = () => {
      keyed.current = false;
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);

  // The rail left while it had focus — the page shrank, the window narrowed: focus goes to the links, or the page (§8.6).
  // Its list goes with it, and does not come back open when the rail does.
  React.useEffect(() => {
    if (view.mode === "rail") return;
    setListOpen(false);
    if (!railHadFocus.current) return;
    railHadFocus.current = false;
    if (document.activeElement && document.activeElement !== document.body) return;
    ((view.mode === "links" ? linksToggle.current : null) ?? document.getElementById(regionId))?.focus({ preventScroll: true });
  }, [view.mode, regionId]);

  /** Opens or closes the rail's list. `from` is what asked, when it was not the rail's own control. */
  const showList = (next: boolean, from: HTMLElement | null = null) => {
    if (next) {
      headed.current = false;
      opener.current = from;
    }
    setListOpen(next);
  };

  /**
   * A section link. It is a real anchor — a modified click opens it like any
   * other — and a plain activation scrolls to the heading, then writes the
   * stable hash by replacement, so ten jumps are not ten Back presses (§8.4).
   */
  const activate = (event: React.MouseEvent<HTMLAnchorElement>, index: number, from: "links" | "list" | "panel") => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const section = sections[index];
    const node = section ? sectionNode(section) : null;
    if (!section || !node) return;
    event.preventDefault();
    chosen.current = section.id;
    // A click with no pointer behind it is the keyboard: focus follows to the heading (§8.5).
    // The disclosure's link is gone once it closes, so focus follows there too.
    const toHeading = from === "links" || event.detail === 0 || keyed.current;
    // The disclosure closes first: its list is part of the page's height, and the heading is measured without it.
    if (from === "links") flushSync(() => setLinksOpen(false));
    // The list has done its work, and steps out of the way of the section it led to (§8.2).
    // After a pointer the rail's own control keeps focus, wherever the list was opened from.
    if (from === "list") {
      if (!toHeading) opener.current = null;
      setListOpen(false);
    }
    const root = document.scrollingElement ?? document.documentElement;
    const offset = node.getBoundingClientRect().top + root.scrollTop;
    scrollPage(sectionTarget(offset, geometry.current.sticky, maxScroll(root.scrollHeight, root.clientHeight)), true, () => {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${section.id}`);
      if (toHeading) {
        focusHeading(node);
        headed.current = from === "list";
      }
      sync.current();
    });
  };

  /** A press on the marker picks it up where it was held; a press on the rail brings the marker there first (§8.4). */
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag.current) return;
    const { max, travel } = geometry.current;
    const top = event.currentTarget.getBoundingClientRect().top;
    const y = event.clientY - top;
    const onMarker = (event.target as Element).closest("[data-ruler-marker]") !== null;
    drag.current = {
      pointer: event.pointerId,
      grab: onMarker ? y - markerY(progress(window.scrollY, max), RAIL_PAD, travel) : 0,
      from: window.scrollY,
      top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!onMarker) scrollPage(progressAt(y, RAIL_PAD, travel) * max, false);
    setDragging(true);
  };

  /** The page follows the pointer directly — no easing, nothing to catch up with. */
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    if (!held || held.pointer !== event.pointerId) return;
    const { max, travel } = geometry.current;
    scrollPage(progressAt(event.clientY - held.top - held.grab, RAIL_PAD, travel) * max, false);
  };

  /** Only while the rail itself has focus; everywhere else the keys are the browser's (§8.5). */
  const onRailKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return;
    const { max, viewport } = geometry.current;
    const target = keyboardTarget(event.key, window.scrollY, max, viewport);
    if (target === null) return;
    event.preventDefault();
    // Focused by a press, now driven by keys: the labels belong to keyboard use.
    setFocused(true);
    scrollPage(target, false);
  };

  // One overlay at a time (§14.2): while the list is open, hover and focus show nothing beside it.
  const peek = (hovered || focused || dragging) && !dismissed && !listOpen;
  // The panel needs its gutter, and a rail long enough to place labels along; without both it is the one label (§8.2).
  const panelShown = peek && view.roomy && view.travel >= COMPACT_TRAVEL;
  const label = t("ruler.onThisPage");

  const linksNav =
    view.mode === "links" ? (
      <nav
        ref={links}
        aria-label={label}
        data-testid="on-this-page"
        className={cn("print:hidden", linksSlot ? "mb-(--nesto-space-section)" : "mb-4")}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !linksOpen) return;
          event.stopPropagation();
          setLinksOpen(false);
          linksToggle.current?.focus();
        }}
      >
        <Button
          ref={linksToggle}
          type="button"
          variant="secondary"
          size="sm"
          aria-expanded={linksOpen}
          aria-controls={listId}
          onClick={(event) => {
            // Safari does not focus a button that is clicked: taken here, so Escape reaches the list it opened.
            event.currentTarget.focus({ preventScroll: true });
            setLinksOpen((value) => !value);
          }}
        >
          <List aria-hidden="true" />
          {label}
          <ChevronDown aria-hidden="true" className={cn("transition-transform", linksOpen && "rotate-180")} />
        </Button>
        {linksOpen ? (
          <RulerSectionList
            id={listId}
            sections={sections}
            active={active}
            className="mt-2 max-w-md rounded-lg border border-line bg-surface p-1"
            onActivate={(event, index) => activate(event, index, "links")}
          />
        ) : null}
      </nav>
    ) : null;

  return (
    <>
      {/* What keeps the rail's 44px clear (styles/tokens-v2.css): in the first byte of HTML, so nothing moves when the rail arrives. */}
      <span hidden data-page-ruler="" />

      {/*
        The rail is the page's last tab stop. This is the same way in from the top of the content, for the
        keyboard: unseen until Tab reaches it, and it opens the rail's list of sections (§8.5).
      */}
      {view.mode === "rail" ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={listOpen}
          data-testid="scroll-ruler-skip"
          onClick={(event) => showList(true, event.currentTarget)}
          className="sr-only focus:not-sr-only focus:absolute focus:z-(--nesto-z-sticky) focus:rounded-md focus:bg-surface focus:px-3 focus:py-1.5 focus:text-table focus:font-medium focus:text-fg focus:shadow-menu"
        >
          {label}
        </button>
      ) : null}

      {/* At the top of the page, or where the page says they go: under its title (`PageSectionLinks`). */}
      {linksSlot ? createPortal(linksNav, linksSlot) : linksNav}

      {children}

      {mounted
        ? createPortal(
            // Always there, so the sticky stack and the unobscured viewport can be measured from it; inert until the rail is in it.
            <div
              ref={frame}
              data-ruler-frame=""
              className="pointer-events-none fixed right-0 top-[var(--nesto-sticky-cover)] bottom-[var(--nesto-bottom-reserve,0px)] z-[var(--nesto-z-ruler)] w-[var(--nesto-ruler-width)] print:hidden"
            >
              {/* The rail's own lane: the frame, less the room a page's context tabs need before they pin. */}
              <div ref={lane} className="absolute inset-x-0 bottom-0 top-[var(--nesto-ruler-inset)]">
              {view.mode === "rail" ? (
                <div
                  className="pointer-events-auto relative h-full"
                  data-open={peek || undefined}
                  onPointerEnter={() => {
                    // A pointer on its way to the native scrollbar crosses the rail; only one that stays shows the labels.
                    window.clearTimeout(hoverIntent.current);
                    hoverIntent.current = window.setTimeout(() => setHovered(true), HOVER_INTENT_MS);
                  }}
                  onPointerLeave={() => {
                    window.clearTimeout(hoverIntent.current);
                    setHovered(false);
                    if (!focused) setDismissed(false);
                  }}
                  onFocus={(event) => {
                    railHadFocus.current = true;
                    // A pointer press focuses the rail too; only keyboard focus holds the labels open.
                    if (event.target.matches(":focus-visible")) setFocused(true);
                  }}
                  onBlur={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget)) return;
                    railHadFocus.current = false;
                    setFocused(false);
                    setDismissed(false);
                  }}
                  onKeyDown={(event) => {
                    // Escape closes the labels and nothing else; it never leaves the page (§8.5). The list closes itself.
                    if (event.key !== "Escape" || listOpen || !peek) return;
                    event.stopPropagation();
                    // The panel takes its links with it. Focus on one of them moves first to the rail, which stays,
                    // so it is never dropped to the top of the page.
                    if (panel.current?.contains(document.activeElement)) rail.current?.focus({ preventScroll: true });
                    setDismissed(true);
                  }}
                >
                  {/*
                    "On this page": the list of every section, as a popover — an explicit press, never hover — and
                    the way to a section that needs no drag (§8.2, §8.5). Before the scale in the tab order, as on screen.
                  */}
                  <Popover open={listOpen} onOpenChange={(next) => showList(next)}>
                    <TooltipProvider delayDuration={TOOLTIP_OPEN_MS}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              aria-label={label}
                              data-testid="scroll-ruler-control"
                              style={{ height: CONTROL_HEIGHT }}
                              className={cn(
                                "absolute inset-x-0 top-0 z-10 grid cursor-pointer place-items-center transition-colors hover:text-fg",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                                listOpen ? "text-fg" : "text-fg-subtle",
                              )}
                            >
                              <List aria-hidden="true" className="size-3.5" />
                            </button>
                          </PopoverTrigger>
                        </TooltipTrigger>
                        {/* For the eye: the label is already the button's name (§9.1). */}
                        <TooltipContent side="left" aria-hidden="true">{label}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <PopoverContent
                      side="left"
                      align="start"
                      aria-label={label}
                      data-testid="scroll-ruler-list"
                      className="w-60 p-1"
                      onOpenAutoFocus={(event) => {
                        // Opens on the section being read, not on the first one.
                        const current = list.current?.querySelector<HTMLElement>('[aria-current="location"]');
                        if (!current) return;
                        event.preventDefault();
                        current.focus({ preventScroll: true });
                      }}
                      onCloseAutoFocus={(event) => {
                        // Focus returns to what opened the list (§8.5) — unless a section was chosen from the
                        // keyboard and its heading already has it.
                        const back = opener.current;
                        opener.current = null;
                        if (headed.current) {
                          headed.current = false;
                          event.preventDefault();
                        } else if (back?.isConnected) {
                          event.preventDefault();
                          back.focus({ preventScroll: true });
                        }
                      }}
                    >
                      <nav ref={list} aria-label={label}>
                        <p aria-hidden="true" className="px-3 pb-1 pt-1.5 text-meta font-semibold text-fg-subtle">{label}</p>
                        <RulerSectionList
                          id={`${listId}-rail`}
                          sections={sections}
                          active={active}
                          onActivate={(event, index) => activate(event, index, "list")}
                        />
                      </nav>
                    </PopoverContent>
                  </Popover>

                  <div
                    ref={rail}
                    role="scrollbar"
                    tabIndex={0}
                    aria-label={t("ruler.label")}
                    aria-orientation="vertical"
                    aria-controls={regionId}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={0}
                    data-testid="scroll-ruler"
                    data-dragging={dragging || undefined}
                    className={cn(
                      "relative h-full w-full cursor-pointer touch-none select-none transition-colors focus-visible:-outline-offset-2",
                      peek ? "bg-surface text-fg-subtle" : "text-line-strong",
                    )}
                    onKeyDown={onRailKeyDown}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={() => endDrag()}
                    onPointerCancel={() => endDrag()}
                    onLostPointerCapture={() => endDrag()}
                  >
                    <Ticks travel={view.travel} />
                    {/* Where the sections are; markers that would collide are one mark, and the list keeps every link (§8.3). */}
                    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
                      {view.clusters.map((cluster) => (
                        <span
                          key={cluster.members[0]}
                          style={{ top: RAIL_PAD + Math.round(cluster.position) }}
                          className={cn(
                            "absolute left-[7px] h-0.5 -translate-y-1/2 rounded-full transition-[width,background-color] forced-colors:bg-[CanvasText]",
                            cluster.members.includes(active) ? "w-3 bg-accent" : "w-2 bg-current",
                          )}
                        />
                      ))}
                    </span>
                    <div ref={marker} data-ruler-marker="" className="absolute left-0 top-0 w-full will-change-transform">
                      {/* The 44px hit area the 2px marker is held by. */}
                      <span className={cn("absolute left-0 top-0 size-11 -translate-y-1/2", dragging ? "cursor-grabbing" : "cursor-grab")} />
                      {/* Drawn as backgrounds, which a forced palette removes: there the scale and the marker take system colours (§8.5). */}
                      <span className="pointer-events-none absolute inset-x-[7px] top-0 h-0.5 -translate-y-1/2 rounded-full bg-accent forced-colors:bg-[Highlight]" />
                      <span
                        ref={readout}
                        aria-hidden="true"
                        data-testid="scroll-ruler-readout"
                        className={cn(
                          "pointer-events-none absolute bottom-1 right-[7px] rounded-sm bg-surface px-1 font-mono text-meta font-semibold tabular-nums text-fg transition-opacity",
                          peek ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {/* No gutter for the panel: the section being read, beside the marker and moving with it (§8.2). */}
                      {peek && !panelShown && sections[active] ? (
                        <RulerSectionLabel label={sections[active].label} className="absolute right-full top-0 mr-1 -translate-y-1/2" />
                      ) : null}
                    </div>
                  </div>

                  {/* Over an empty gutter only: there is nothing under it to cover (§8.2). */}
                  {panelShown ? (
                    <nav
                      ref={panel}
                      aria-label={label}
                      data-testid="scroll-ruler-panel"
                      className="absolute right-full top-0 h-full w-40 border-x border-line bg-surface shadow-menu"
                    >
                      {view.clusters.map((cluster) => {
                        const index = cluster.members.includes(active) ? active : cluster.members[0];
                        const section = sections[index];
                        if (!section) return null;
                        return (
                          <a
                            key={section.id}
                            href={`#${section.id}`}
                            // A label cut short by the panel's width is whole here, and in the list.
                            title={section.label}
                            aria-current={index === active ? "location" : undefined}
                            onClick={(event) => activate(event, index, "panel")}
                            style={{ top: RAIL_PAD + Math.round(cluster.position) }}
                            className={cn(
                              "absolute inset-x-0 flex h-6 -translate-y-1/2 items-center justify-end gap-1 px-3 text-meta transition-colors",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                              index === active ? "font-semibold text-fg" : "text-fg-muted hover:text-fg",
                            )}
                          >
                            <span className="truncate">{section.label}</span>
                            {/* The others at this mark: each has its own link in the list. */}
                            {cluster.members.length > 1 ? <span aria-hidden="true" className="shrink-0 font-normal tabular-nums text-fg-subtle">+{cluster.members.length - 1}</span> : null}
                          </a>
                        );
                      })}
                    </nav>
                  ) : null}
                </div>
              ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
