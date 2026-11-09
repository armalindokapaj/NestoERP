import { anchorTarget, readingAnchor, type SectionAnchor } from "@/lib/ui/ruler-math";

/**
 * Coming Back to a list or a record (UI-02 §7.4, §8.6; acceptance UI02-06).
 *
 * A page that registers sections is returned to by section
 * (lib/ui/section-return.ts, components/ui/scroll-ruler.tsx). Most pages
 * register none — a register of invoices, a contract — and this file gives
 * them the same thing with what they do have: the rows, cards and headings on
 * the page. The place a reader left is the last of those that had crossed the
 * top of the visible page, and the distance past it; coming Back, the page goes
 * to that row or heading where it is now. Never a pixel position or a
 * percentage: a list that gained three rows above still opens on the row that
 * was being read.
 *
 * It is the same mechanism, not a second one: the same store and key
 * (`nesto.ui.section-return`), the same traversal watch, the same arithmetic
 * (`readingAnchor`, `anchorTarget`, `returnStep` in lib/ui/ruler-math.ts).
 * Only where the anchors come from differs.
 *
 * What is stored is a hash, so the tab's storage names no record. Permission
 * is rechecked by construction (§7.4): the page returned to is rendered for
 * the reader as they are now, and a place is only ever found among what that
 * page shows. A record that was revoked, deleted or moved is not on it, and
 * then nothing is restored — the page stays at its top.
 *
 * The first half is pure and held by tests/unit/navigation/scroll-memory.test.ts;
 * the second half reads the page.
 */

/** Marks a place found on the page, against a registered section's id (kebab-case, lib/ui/section-id.ts). */
export const PLACE_PREFIX = "~";
/** Places measured on one page; a longer page keeps its first this many. */
export const PLACE_LIMIT = 1500;
/** How long the page must rest before its place is read: nothing is measured while it scrolls (§8.7). */
export const PLACE_IDLE_MS = 100;

export type PlaceKind = "link" | "id" | "heading";
export type PlaceCandidate = { kind: PlaceKind; value: string; top: number };

/** FNV-1a, 32 bits. Two rounds with different seeds make the key; nothing can be read back from it. */
function hash(text: string, seed: number): string {
  let value = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(36);
}

/** The stored name of a place: its kind and what identifies it on the page, hashed. */
export function placeKey(kind: PlaceKind, value: string): string {
  const text = `${kind}:${value}`;
  return `${PLACE_PREFIX}${hash(text, 0x811c9dc5)}${hash(text, 0x9747b28c)}`;
}

export function isPlaceAnchor(id: string): boolean {
  return id.startsWith(PLACE_PREFIX);
}

/**
 * An id React or a component library made up for this render (`:r1:`, `«r1»`,
 * `_R_1ipnb_`, `radix-…`): the next render hands the same id to another element.
 */
export function generatedId(id: string): boolean {
  return /[:«»]/.test(id) || /^(radix-|_r_|react-aria)/i.test(id);
}

/** A heading's words as they identify it: trimmed, single-spaced, and not all of a long one. */
export function headingValue(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * The page's places, top to bottom. A row's link and the same link repeated in
 * its last cell are one place — the first — and so is a heading that occurs
 * twice, so an anchor always means one position on the page.
 */
export function orderPlaces(candidates: readonly PlaceCandidate[]): { ids: string[]; offsets: number[] } {
  const seen = new Set<string>();
  const places: { id: string; top: number }[] = [];
  for (const candidate of candidates) {
    if (!candidate.value || !Number.isFinite(candidate.top)) continue;
    const id = placeKey(candidate.kind, candidate.value);
    if (seen.has(id)) continue;
    seen.add(id);
    places.push({ id, top: candidate.top });
  }
  places.sort((a, b) => a.top - b.top);
  return { ids: places.map((place) => place.id), offsets: places.map((place) => place.top) };
}

/** The place being read, or `null` for a page at its top or with nothing to anchor to: that page is forgotten. */
export function placeAt(candidates: readonly PlaceCandidate[], scrollTop: number, line: number): SectionAnchor | null {
  if (scrollTop < 1) return null;
  const { ids, offsets } = orderPlaces(candidates);
  return readingAnchor(ids, offsets, scrollTop, line);
}

/** Where a remembered place is on the page as it is now; `null` when it is not there — and then nothing moves. */
export function placeTarget(anchor: SectionAnchor, candidates: readonly PlaceCandidate[], line: number, max: number): number | null {
  if (!isPlaceAnchor(anchor.id)) return null;
  const { ids, offsets } = orderPlaces(candidates);
  return anchorTarget(anchor, ids, offsets, line, max);
}

/* ------------------------------------------------------------------ */

/** Where a page's own content is: all three shells name their main region the same. */
const REGION_ID = "nesto-main";
const PLACES = 'a[href^="/"], h1, h2, h3, h4, [id]';
/**
 * What is pinned, or may be: a tab row, a page toolbar, an action bar, a
 * table's head, anything positioned by a `sticky` or `fixed` class. Its place
 * in the document moves as the page scrolls, so nothing in it can say where
 * the reader was.
 */
const PINNED = '[data-context-tabs], [data-sticky-region], [data-sticky-action-bar], [data-mobile-action-bar], [data-shell-breadcrumb], thead, [class*="sticky"], [class~="fixed"]';

/**
 * The line content appears under: everything pinned, plus the clearance an
 * anchor is given (`scroll-padding-top`, styles/globals.css). Read from the
 * root's computed style, so it is whatever the shell pins at this size.
 */
export function readingLine(): number {
  const value = parseFloat(window.getComputedStyle(document.documentElement).scrollPaddingTop);
  return Number.isFinite(value) ? value : 0;
}

/** Every place on the page now, with its distance from the top of the document. One pass of layout reads, no writes. */
export function measurePlaces(scrollTop: number): PlaceCandidate[] {
  const region = document.getElementById(REGION_ID);
  if (!region) return [];
  const candidates: PlaceCandidate[] = [];
  for (const node of region.querySelectorAll<HTMLElement>(PLACES)) {
    if (candidates.length >= PLACE_LIMIT) break;
    let kind: PlaceKind;
    let value: string;
    if (node instanceof HTMLAnchorElement) {
      kind = "link";
      value = node.getAttribute("href") ?? "";
    } else if (/^H[1-4]$/.test(node.tagName)) {
      kind = "heading";
      value = headingValue(node.textContent ?? "");
    } else {
      kind = "id";
      value = generatedId(node.id) ? "" : node.id;
    }
    if (!value) continue;
    // Pinned inside the page — what the shell around the region is made of is not the page's.
    const pinned = node.closest(PINNED);
    if (pinned && pinned !== region && region.contains(pinned)) continue;
    const box = node.getBoundingClientRect();
    // Not drawn: a table kept for wide screens, a closed panel.
    if (box.width === 0 && box.height === 0) continue;
    candidates.push({ kind, value, top: box.top + scrollTop });
  }
  return candidates;
}
