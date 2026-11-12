/**
 * The arithmetic behind the phone gestures (mobile audit stage 5): a card's
 * swipe to reveal its actions (components/ui/swipe-actions.tsx), the shell's
 * pull to refresh (components/layout/pull-to-refresh.tsx) and the keyboard
 * inset the bottom action bar rides on (components/ui/mobile-action-bar.tsx).
 *
 * Framework-free, so it is unit-tested on its own. Distances are CSS pixels,
 * time is milliseconds.
 */

/** How far a finger moves before the gesture decides whether it is across or along the page. */
export const AXIS_SLOP = 8;

/**
 * Which way a touch is going, once it has moved far enough to say: `x`
 * (across, a swipe), `y` (along, a scroll or a pull), or `null` while it is
 * still inside the slop. Across must clearly win — a diagonal is a scroll, so
 * reading down a list never opens a card.
 */
export function lockAxis(dx: number, dy: number, slop: number = AXIS_SLOP): "x" | "y" | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < slop && ay < slop) return null;
  return ax > ay * 1.2 ? "x" : "y";
}

/** Past an end the card follows the finger at a fifth of its pace, so it feels held rather than stuck. */
const RUBBER = 0.2;

/**
 * Where a card sits while it is dragged. `base` is where the drag began (0
 * closed, `-width` open), `dx` how far the finger has moved, `width` the width
 * of the revealed actions. Left (negative) reveals; the card never goes right
 * of its place or left of its actions without resistance.
 */
export function swipeOffset(base: number, dx: number, width: number): number {
  const next = base + dx;
  if (next > 0) return next * RUBBER;
  if (next < -width) return -width + (next + width) * RUBBER;
  return next;
}

/** A flick this fast (px per ms) settles the card the way it was going, however far it got. */
export const FLICK_VELOCITY = 0.4;

/**
 * Whether a released card stays open: a flick decides by its direction;
 * otherwise more than half the actions showing keeps them showing.
 */
export function swipeSettlesOpen(offset: number, velocity: number, width: number): boolean {
  if (width <= 0) return false;
  if (velocity <= -FLICK_VELOCITY) return true;
  if (velocity >= FLICK_VELOCITY) return false;
  return offset <= -width / 2;
}

/** How far the pull-to-refresh indicator travels at most. */
export const PULL_MAX = 120;
/** How far it must travel before letting go refreshes. */
export const PULL_THRESHOLD = 72;

/**
 * The indicator's travel for a finger `dy` pixels down: half the finger's
 * distance, easing off towards `max`, so a long pull never runs away.
 */
export function pullDistance(dy: number, max: number = PULL_MAX): number {
  if (dy <= 0) return 0;
  const half = dy / 2;
  // Linear while well short of the cap, then a smooth approach to it.
  const knee = max * 0.6;
  if (half <= knee) return half;
  const over = half - knee;
  const room = max - knee;
  return knee + room * (1 - Math.exp(-over / room));
}

/** How far along the pull is, 0 to 1, where 1 means letting go now refreshes. */
export function pullProgress(distance: number, threshold: number = PULL_THRESHOLD): number {
  if (threshold <= 0) return 1;
  return Math.max(0, Math.min(1, distance / threshold));
}
