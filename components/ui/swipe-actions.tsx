"use client";

import * as React from "react";
import { Loader2 } from "@/components/icons";

import { useIsBelow } from "@/components/ui/use-breakpoint";
import { lockAxis, swipeOffset, swipeSettlesOpen } from "@/lib/ui/gestures";
import { cn } from "@/lib/utils/cn";

/**
 * Swipe a card left to reveal its actions (mobile audit 5a). Phones only — a
 * finger below `md`; a mouse, a pen and every width from `md` get the card as
 * it is, and nothing extra is in the page there.
 *
 *   <SwipeActions actions={<SwipeAction tone="success" icon={<Check />} label="Complete" onAction={complete} />}>
 *     …the card…
 *   </SwipeActions>
 *
 * - The swipe only reveals. Nothing happens until a revealed button is
 *   pressed, and that runs the same action the page offers without swiping
 *   (Reject still opens its reason). The actions are always reachable
 *   another way: the card opens its record, where the buttons are.
 * - Axis-locked: a touch that moves along the page is a scroll and the card
 *   never moves; only a clearly sideways one is a swipe (`lockAxis`). The card
 *   lets the browser keep vertical panning and pinch zoom (`touch-action`).
 * - One card open at a time. A tap elsewhere, a scroll anywhere, Escape, or a
 *   tap on the open card itself closes it; that tap does not open the record.
 * - The revealed buttons are real buttons with names; while hidden they are
 *   inert, so neither focus nor a screen reader reaches them.
 * - Reduced motion: the card follows the finger (that is the finger's own
 *   movement) but settles without easing.
 *
 * `actions` should be `SwipeAction`s, or components rendering one. Pass
 * nothing (`undefined`) when the reader may take none of them: the card is
 * then exactly the card.
 */

type SwipeContextValue = { close: () => void };

const SwipeContext = React.createContext<SwipeContextValue | null>(null);

/** The card whose actions are showing; opening another closes it. */
let openCard: SwipeContextValue | null = null;

const REDUCED = "(prefers-reduced-motion: reduce)";
/** A drag that ended this recently swallows the click it would otherwise make. */
const CLICK_GUARD_MS = 400;

type Drag = { pointer: number; x: number; y: number; base: number; width: number; axis: "x" | "y" | null; lastX: number; lastT: number; velocity: number };

export function SwipeActions({
  actions,
  children,
  className,
  contentClassName,
}: {
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** The outer box (a card's rounded corners, say). */
  className?: string;
  /** The part that slides: it carries the card's padding and an opaque background. */
  contentClassName?: string;
}) {
  const phone = useIsBelow("md") === true;
  const enabled = phone && actions !== undefined && actions !== null && actions !== false;
  const root = React.useRef<HTMLDivElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<Drag | null>(null);
  const clickGuardUntil = React.useRef(0);
  const hideTimer = React.useRef<number | null>(null);
  const [open, setOpen] = React.useState(false);

  /** Moves the card; the actions behind it are shown only while some of them can be seen. */
  const place = React.useCallback((offset: number, animate: boolean) => {
    const node = content.current;
    const actionsNode = panel.current;
    if (!node) return;
    const ease = animate && !window.matchMedia(REDUCED).matches;
    node.style.transition = ease ? "transform 200ms var(--nesto-ease)" : "none";
    node.style.transform = offset ? `translate3d(${offset}px, 0, 0)` : "";
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    if (!actionsNode) return;
    if (offset) actionsNode.style.visibility = "visible";
    // Hidden once the card is back in place, so nothing shows through it.
    else if (ease) hideTimer.current = window.setTimeout(() => (actionsNode.style.visibility = "hidden"), 220);
    else actionsNode.style.visibility = "hidden";
  }, []);

  const handle = React.useMemo<SwipeContextValue>(
    () => ({
      close: () => {
        drag.current = null;
        setOpen(false);
        place(0, true);
        if (openCard === handle) openCard = null;
      },
    }),
    // `handle` refers to itself only through `openCard`; `place` is stable.
    [place],
  );

  const reveal = React.useCallback(
    (width: number) => {
      if (openCard && openCard !== handle) openCard.close();
      openCard = handle;
      setOpen(true);
      place(-width, true);
    },
    [handle, place],
  );

  // Open: a tap elsewhere, a scroll anywhere or Escape closes it.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      handle.close();
    };
    const onScroll = () => handle.close();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handle.close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, handle]);

  // Wider than a phone, or no actions any more: the card goes back.
  React.useEffect(() => {
    if (!enabled && open) handle.close();
  }, [enabled, open, handle]);

  React.useEffect(
    () => () => {
      if (openCard === handle) openCard = null;
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    },
    [handle],
  );

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!enabled || event.pointerType !== "touch" || !event.isPrimary) return;
    const width = panel.current?.offsetWidth ?? 0;
    if (width === 0) return;
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, base: open ? -width : 0, width, axis: null, lastX: event.clientX, lastT: event.timeStamp, velocity: 0 };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointer) return;
    const dx = event.clientX - current.x;
    if (current.axis === null) {
      current.axis = lockAxis(dx, event.clientY - current.y);
      if (current.axis === null) return;
      if (current.axis === "y") {
        // A scroll: the browser has it.
        drag.current = null;
        return;
      }
      // Sideways: this card has the finger now, and any other open card closes.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Capture is a nicety; the drag works without it.
      }
      if (openCard && openCard !== handle) openCard.close();
    }
    const elapsed = event.timeStamp - current.lastT;
    if (elapsed > 0) current.velocity = (event.clientX - current.lastX) / elapsed;
    current.lastX = event.clientX;
    current.lastT = event.timeStamp;
    place(swipeOffset(current.base, dx, current.width), false);
  }

  function onPointerEnd(event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointer) return;
    drag.current = null;
    if (current.axis !== "x") return;
    clickGuardUntil.current = Date.now() + CLICK_GUARD_MS;
    // A cancelled pointer may report no position: the last one it moved to stands.
    const offset = swipeOffset(current.base, (cancelled ? current.lastX : event.clientX) - current.x, current.width);
    if (swipeSettlesOpen(offset, cancelled ? 0 : current.velocity, current.width)) reveal(current.width);
    else handle.close();
  }

  return (
    <div ref={root} data-swipe-actions data-swipe-open={open || undefined} className={cn("relative", enabled && "overflow-hidden", className)}>
      {enabled ? (
        <div ref={panel} data-swipe-panel className="absolute inset-y-0 right-0 flex" style={{ visibility: "hidden" }} inert={!open} aria-hidden={open ? undefined : true}>
          <SwipeContext.Provider value={handle}>{actions}</SwipeContext.Provider>
        </div>
      ) : null}
      <div
        ref={content}
        className={cn("relative", enabled && "touch-pan-y touch-pinch-zoom", contentClassName)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => onPointerEnd(event, false)}
        onPointerCancel={(event) => onPointerEnd(event, true)}
        onClickCapture={(event) => {
          // The tap that ends a swipe, or a tap on an open card, only closes it: it never opens the record.
          if (!open && Date.now() > clickGuardUntil.current) return;
          event.preventDefault();
          event.stopPropagation();
          if (open) handle.close();
        }}
      >
        {children}
      </div>
    </div>
  );
}

const TONES = {
  success: "bg-success-strong text-primary-fg",
  danger: "bg-danger text-danger-fg",
  neutral: "bg-surface-muted text-fg",
} as const;

/**
 * One revealed action: a full-height button with an icon over its word.
 * `onAction` runs the page's own action; while a promise it returns is
 * pending the button shows that it is working, then the card closes.
 */
export function SwipeAction({
  label,
  icon,
  tone = "neutral",
  onAction,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: {
  label: string;
  icon: React.ReactNode;
  tone?: keyof typeof TONES;
  onAction: () => void | Promise<unknown>;
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  const card = React.useContext(SwipeContext);
  const [busy, setBusy] = React.useState(false);
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
      disabled={busy}
      data-testid={testId}
      data-swipe-action={tone}
      className={cn(
        "flex w-[76px] shrink-0 flex-col items-center justify-center gap-1 px-1 text-meta font-semibold leading-tight focus-visible:outline-offset-[-4px] disabled:opacity-80",
        TONES[tone],
      )}
      onClick={() => {
        const result = onAction();
        if (!result || typeof (result as Promise<unknown>).then !== "function") {
          card?.close();
          return;
        }
        setBusy(true);
        void (result as Promise<unknown>).finally(() => {
          setBusy(false);
          card?.close();
        });
      }}
    >
      <span aria-hidden="true" className="grid size-5 place-items-center [&_svg]:size-5">
        {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : icon}
      </span>
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}
