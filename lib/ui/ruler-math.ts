/**
 * The Architectural Scroll Ruler's arithmetic (UI-02 §8.1, §8.3, §8.5).
 *
 * The ruler says where a finite page is scrolled to and which of its sections
 * is being read. Everything it decides from numbers is here, pure — no DOM, no
 * React — so the component (components/ui/scroll-ruler.tsx) only measures and
 * paints, and the rule is the one the tests hold (UI02-18, UI02-19).
 *
 * All offsets are in the registered scroller's own coordinate space: for the
 * document, a section's offset is its heading's distance from the top of the
 * page, and `occludingStickyHeight` is the sticky stack that covers the top of
 * the viewport. A scroller that already starts below the shell passes zero, so
 * the header is never subtracted twice (§8.3).
 */

/** A jump lands the heading this far below the sticky stack (§8.3). */
export const SECTION_CLEARANCE = 12;
/** A heading is "crossed" once it is above a line this far below the unobscured viewport's top (§8.3). */
export const ACTIVATION_OFFSET = 16;
/** Arrow Up / Arrow Down, while the ruler has focus (§8.5). */
export const ARROW_STEP = 40;
/** Ticks: a major every 10 percent, a minor every 2 (§8.2). */
export const MAJOR_TICK = 10;
export const MINOR_TICK = 2;
/** Minor ticks closer than this are noise: a short rail draws majors only (§8.2). */
export const MIN_MINOR_TICK_GAP = 5;
/** No more than eight section links are labelled directly; the rest are in the ordered list (§8.2). */
export const MAX_DIRECT_LABELS = 8;
/** Two labels, or two section markers, nearer than this collide and are drawn as one (§8.3). */
export const MARKER_GAP = 24;
/** The labelled section panel is this wide, and opens only over an empty gutter at least as wide (§8.2). */
export const LABEL_PANEL_WIDTH = 160;
/** §8.1: the rail needs a desktop viewport, a page worth measuring and enough places to go. */
export const RULER_MIN_WIDTH = 1280;
export const RULER_MIN_PAGE_RATIO = 1.5;
export const RULER_MIN_SECTIONS = 3;
/**
 * Measured heights round to a pixel, so a page sitting exactly on a threshold
 * would otherwise show and hide its ruler on alternate measurements. What is
 * shown stays until the page has moved this far the other way.
 */
export const RULER_SLACK = 8;
/** A return waits this long for its section to arrive, then keeps the place this long while the page settles (§8.6). */
export const RETURN_WAIT_MS = 5000;
export const RETURN_HOLD_MS = 2000;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), Math.max(min, max));
}

/** How far the scroller can travel; zero for a page that fits. */
export function maxScroll(scrollHeight: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - clientHeight) || 0;
}

/** 0 at the top, 1 at the bottom; a page with nothing to scroll is at 0, never at "100%" (§8.6). */
export function progress(scrollTop: number, max: number): number {
  return max > 0 ? clamp(scrollTop / max, 0, 1) : 0;
}

export function displayPercent(value: number): number {
  return Math.round(clamp(value, 0, 1) * 100);
}

/** Where the marker sits on the rail, in the rail's own pixels. */
export function markerY(value: number, railStart: number, usableRailTravel: number): number {
  return railStart + clamp(value, 0, 1) * Math.max(0, usableRailTravel);
}

/** The inverse of `markerY`: the progress a point on the rail stands for (a click, a drag; §8.4). */
export function progressAt(y: number, railStart: number, usableRailTravel: number): number {
  return usableRailTravel > 0 ? clamp((y - railStart) / usableRailTravel, 0, 1) : 0;
}

/** The scroll position that brings a section's heading just under the sticky stack. */
export function sectionTarget(sectionOffset: number, occludingStickyHeight: number, max: number): number {
  return clamp(sectionOffset - occludingStickyHeight - SECTION_CLEARANCE, 0, max);
}

/** A section's place on the rail, 0–1. Sections near the bottom may share one: see `clusterMarkers`. */
export function sectionMarker(target: number, max: number): number {
  return max > 0 ? clamp(target / max, 0, 1) : 0;
}

/**
 * The section being read: the last one, in page order, whose heading has
 * crossed the activation line. Before the first heading it is the first
 * section; at the bottom it is the last, because the headings still below the
 * line can never reach it (§8.3). -1 only when there are no sections.
 *
 * `sectionOffsets` is in page order, and nothing here looks at the rail: the
 * answer comes from where the headings are, not from where a marker is drawn.
 */
export function activeSection(sectionOffsets: readonly number[], scrollTop: number, max: number, occludingStickyHeight: number): number {
  const last = sectionOffsets.length - 1;
  if (last < 0) return -1;
  // Within a pixel of the end: browsers stop a fraction short of the last pixel at some zoom levels.
  if (max > 0 && scrollTop >= max - 1) return last;
  const line = scrollTop + occludingStickyHeight + ACTIVATION_OFFSET;
  let active = 0;
  for (let index = 0; index <= last; index += 1) {
    if (sectionOffsets[index] <= line) active = index;
  }
  return active;
}

/**
 * Sections that sit side by side, or that all clamp to the bottom, share one
 * scroll position, and position alone cannot say which of them a person just
 * chose. Among sections the scroll position cannot tell apart, the one that
 * was explicitly activated stays the answer; once the page moves on, it is the
 * headings again (§8.3).
 */
export function resolveActive(computed: number, chosen: number, targets: readonly number[]): number {
  if (chosen < 0 || chosen >= targets.length || computed < 0 || computed >= targets.length) return computed;
  return Math.abs(targets[chosen] - targets[computed]) < 1 ? chosen : computed;
}

export type MarkerCluster = {
  /** Where the cluster is drawn, in rail pixels from the start of the travel. */
  position: number;
  /** The sections it stands for, as indexes in page order. Each keeps its own link in the list. */
  members: number[];
};

/**
 * Groups section markers that would collide (§8.3, UI02-25). A cluster is
 * anchored at its first marker and takes every marker within `gap` of it, so
 * two clusters are never nearer than `gap`; if that still leaves more than
 * `limit`, the two nearest neighbours merge until it does not.
 */
export function clusterMarkers(positions: readonly number[], gap: number = MARKER_GAP, limit: number = MAX_DIRECT_LABELS): MarkerCluster[] {
  const order = positions.map((_, index) => index).sort((a, b) => positions[a] - positions[b] || a - b);
  const clusters: MarkerCluster[] = [];
  for (const index of order) {
    const open = clusters[clusters.length - 1];
    if (open && positions[index] - open.position < gap) open.members.push(index);
    else clusters.push({ position: positions[index], members: [index] });
  }
  while (clusters.length > Math.max(1, limit)) {
    let nearest = 1;
    for (let index = 2; index < clusters.length; index += 1) {
      if (clusters[index].position - clusters[index - 1].position < clusters[nearest].position - clusters[nearest - 1].position) nearest = index;
    }
    clusters[nearest - 1].members.push(...clusters[nearest].members);
    clusters.splice(nearest, 1);
  }
  for (const cluster of clusters) cluster.members.sort((a, b) => a - b);
  return clusters;
}

export type RulerTick = { percent: number; major: boolean };

/** The scale: 0, 10 … 100, and the 2 percent steps between them where the rail is long enough to keep them apart. */
export function rulerTicks(usableRailTravel: number): RulerTick[] {
  if (!(usableRailTravel > 0)) return [];
  const minor = (usableRailTravel * MINOR_TICK) / 100 >= MIN_MINOR_TICK_GAP;
  const ticks: RulerTick[] = [];
  for (let percent = 0; percent <= 100; percent += minor ? MINOR_TICK : MAJOR_TICK) {
    ticks.push({ percent, major: percent % MAJOR_TICK === 0 });
  }
  return ticks;
}

/**
 * Whether the labelled panel has an empty gutter to open over (§8.2): the room
 * between the right edge of the page's content and the rail. With less, the
 * panel would cover what is being read, so the ruler shows one compact label
 * and keeps the full list behind its "On this page" control.
 */
export function labelPanelFits(contentRight: number, railLeft: number): boolean {
  return railLeft - contentRight >= LABEL_PANEL_WIDTH;
}

/**
 * Where a key takes the page while the ruler has focus (§8.5): the arrows a
 * fixed 40px, Page Up and Page Down one unobscured viewport, Home and End the
 * ends. `null` for every other key, which the ruler leaves alone.
 */
export function keyboardTarget(key: string, scrollTop: number, max: number, unobscuredViewport: number): number | null {
  switch (key) {
    case "ArrowUp":
      return clamp(scrollTop - ARROW_STEP, 0, max);
    case "ArrowDown":
      return clamp(scrollTop + ARROW_STEP, 0, max);
    case "PageUp":
      return clamp(scrollTop - unobscuredViewport, 0, max);
    case "PageDown":
      return clamp(scrollTop + unobscuredViewport, 0, max);
    case "Home":
      return 0;
    case "End":
      return Math.max(0, max);
    default:
      return null;
  }
}

/** What a page shows: the rail, the compact "On this page" links, or neither. */
export type RulerMode = "rail" | "links" | "none";

export type RulerConditions = {
  /** Version 2 of the design system; version 1 has no ruler at all. */
  enabled: boolean;
  /** The person's choice, or the kill switch: "off" keeps the links and drops the rail (§8.1, §33.3). */
  preference: "auto" | "off";
  /** A viewport at least 1280px wide whose primary pointer is fine. */
  desktop: boolean;
  /** How many sections are registered — only ones the reader may see ever are. */
  sections: number;
  /** The page's own scroll range, without anything the ruler itself adds to it. */
  maxScroll: number;
  /** The page's content height, and the viewport height the sticky stack and bottom bars leave free. */
  contentHeight: number;
  unobscuredViewport: number;
  /** A blocking dialog or drawer is open. The rail steps aside; links already in the page stay where they are (§8.1.5). */
  blocked: boolean;
  /** What is shown now, so a page on a threshold keeps it (see RULER_SLACK). */
  current: RulerMode;
};

/**
 * §8.1 in one place. A page that does not scroll shows nothing — there is no
 * meaningful "100%" on it (§8.6) — and one with fewer than three sections has
 * nowhere worth listing. Past that it is the rail where every condition holds
 * and the same links, compact, where the window, the pointer, the page's
 * length or the preference rules the rail out.
 */
export function rulerMode(input: RulerConditions): RulerMode {
  if (!input.enabled || input.sections < RULER_MIN_SECTIONS) return "none";
  if (!(input.maxScroll > (input.current === "none" ? RULER_SLACK : 0))) return "none";
  if (input.preference === "off" || !input.desktop) return "links";
  const needed = input.unobscuredViewport * RULER_MIN_PAGE_RATIO + (input.current === "rail" ? 0 : RULER_SLACK);
  if (!(input.contentHeight > needed)) return "links";
  // Behind a modal the page is not being read, and links appearing in its flow would move it: nothing at all.
  return input.blocked ? "none" : "rail";
}

/**
 * A place in a page's content rather than a distance from its top (§8.6): a
 * section, and how far past its heading the top of the unobscured viewport is.
 * Negative while the heading is still below that line.
 */
export type SectionAnchor = { id: string; offset: number };

/**
 * The place a reader is at: the last section whose heading has crossed the
 * activation line, and the distance read into it. Unlike `activeSection` the
 * bottom of the page changes nothing — a place is where the headings are, not
 * which label is lit. `null` when the page has no sections.
 */
export function readingAnchor(
  sectionIds: readonly string[],
  sectionOffsets: readonly number[],
  scrollTop: number,
  occludingStickyHeight: number,
): SectionAnchor | null {
  const index = activeSection(sectionOffsets, scrollTop, 0, occludingStickyHeight);
  const id = sectionIds[index];
  if (id === undefined) return null;
  return { id, offset: scrollTop + occludingStickyHeight - sectionOffsets[index] };
}

/**
 * The scroll position that puts a reader back at an anchor, on the page as it
 * is now: unchanged content gives back the position they left, and content
 * that grew or shrank above the section gives the same place in it, which a
 * pixel position or a percentage would not (§8.6). `null` when the section is
 * no longer on the page — there is nowhere to return to, and no guess is made.
 */
export function anchorTarget(
  anchor: SectionAnchor,
  sectionIds: readonly string[],
  sectionOffsets: readonly number[],
  occludingStickyHeight: number,
  max: number,
): number | null {
  const index = sectionIds.indexOf(anchor.id);
  if (index < 0 || !Number.isFinite(sectionOffsets[index]) || !Number.isFinite(anchor.offset)) return null;
  return clamp(sectionOffsets[index] + anchor.offset - occludingStickyHeight, 0, max);
}

export type ReturnStep = { action: "wait" } | { action: "stop" } | { action: "scroll"; top: number };

/**
 * One look at a return in progress, taken each time the page is measured.
 * `expected` is where the return last saw the page — where it found it, then
 * where it put it. A page anywhere else was scrolled by its reader, and is
 * theirs: the return ends and never moves it again. Until then it waits for
 * the section to arrive and keeps the place while the content above settles,
 * and it gives up at the deadline either way.
 */
export function returnStep(input: {
  scrollTop: number;
  expected: number | null;
  /** `anchorTarget` for the page as measured now. */
  target: number | null;
  now: number;
  deadline: number;
}): ReturnStep {
  if (input.expected !== null && Math.abs(input.scrollTop - input.expected) > 1) return { action: "stop" };
  if (input.now > input.deadline) return { action: "stop" };
  if (input.target === null) return { action: "wait" };
  return { action: "scroll", top: input.target };
}
