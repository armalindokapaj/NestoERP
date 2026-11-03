"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { PLACE_IDLE_MS, isPlaceAnchor, measurePlaces, placeAt, placeTarget, readingLine } from "@/lib/navigation/scroll-memory";
import { RETURN_HOLD_MS, RETURN_WAIT_MS, maxScroll, returnStep, type SectionAnchor } from "@/lib/ui/ruler-math";
import { keepTraversal, noteArrival, recallReturn, rememberReturn, returnKey, returnsClaimed, takeTraversal, watchTraversals } from "@/lib/ui/section-return";

type Returning = { address: string; anchor: SectionAnchor; expected: number | null; landed: boolean; deadline: number };

/**
 * Notes when a page was reached by Back or Forward, so the page can put its
 * reader back where they left it (UI-02 §7.4, §8.6; lib/ui/section-return.ts).
 *
 * A page with sections does that itself, by section (components/ui/
 * scroll-ruler.tsx). For every other page — a list, a record — it is done
 * here, from the page's own rows and headings (lib/navigation/
 * scroll-memory.ts): the place is read when the page comes to rest, kept under
 * the page's address, and on a return the page goes to that row where it is
 * now. A row that is no longer on the page restores nothing.
 *
 * `ScrollToTop` still opens every page at its top; only a return moves from
 * there, and a reader who scrolls first keeps the page (`returnStep`). The
 * unsaved-work guard owns `popstate` (lib/unsaved/history-guard.ts): a
 * traversal it holds back never reaches the watch, so nothing is restored on a
 * page that was not left.
 *
 * Version 2 only — the root layout does not mount it in version 1.
 */
export function SectionReturnWatch() {
  const pathname = usePathname();

  React.useEffect(() => watchTraversals(), []);
  React.useEffect(() => keepTraversal(pathname), [pathname]);

  // The query is part of a list's address, and reading it suspends where a page is prerendered.
  return (
    <React.Suspense fallback={null}>
      <PlaceReturn pathname={pathname} />
    </React.Suspense>
  );
}

/** A list's or a record's place, kept as the page rests and gone back to on a return. */
function PlaceReturn({ pathname }: { pathname: string }) {
  // What is on screen, not what the address bar says: on Back the address moves before the page does.
  const address = returnKey(pathname, useSearchParams().toString());
  // A return in progress. A ref: a traversal answers once, and in development an effect runs twice.
  const returning = React.useRef<Returning | null>(null);

  React.useEffect(() => {
    const root = document.scrollingElement ?? document.documentElement;
    let idle = 0;
    let poll = 0;
    let frame = 0;
    if (returning.current?.address !== address) returning.current = null;
    // Every page is noted as it arrives, so the history knows which entries have been shown (lib/ui/section-return.ts).
    noteArrival(address);

    const step = () => {
      const back = returning.current;
      if (!back) return;
      const top = root.scrollTop;
      const now = performance.now();
      const target = placeTarget(back.anchor, measurePlaces(top), readingLine(), maxScroll(root.scrollHeight, root.clientHeight));
      const next = returnStep({ scrollTop: top, expected: back.expected, target, now, deadline: back.deadline });
      if (next.action === "stop") {
        returning.current = null;
        window.clearInterval(poll);
        return;
      }
      if (next.action === "wait") {
        back.expected = top;
        return;
      }
      if (Math.abs(next.top - top) >= 1) window.scrollTo({ top: next.top, behavior: "instant" });
      back.expected = root.scrollTop;
      if (!back.landed) {
        back.landed = true;
        back.deadline = now + RETURN_HOLD_MS;
      }
    };

    const remember = () => {
      window.clearTimeout(idle);
      idle = 0;
      // A return the reader has scrolled away from ends here; one still in progress is not a place they chose.
      step();
      // A page with a ruler keeps its own place, by section.
      if (returning.current || returnsClaimed(address)) return;
      const top = root.scrollTop;
      rememberReturn(address, placeAt(measurePlaces(top), top, readingLine()));
    };

    // Coming back: only by Back or Forward, and only to a place this watch kept (a section is the ruler's).
    const kept = recallReturn(address);
    if (kept && isPlaceAnchor(kept.id) && takeTraversal(address)) {
      returning.current = { address, anchor: kept, expected: null, landed: false, deadline: performance.now() + RETURN_WAIT_MS };
    }
    if (returning.current) {
      // Not from this effect: the shell's own effects for a new page run in this commit too, and send it to its top
      // (components/layout/route-focus.tsx). The first look is a frame later, when they are done.
      frame = window.requestAnimationFrame(step);
      // The row may still be on its way (a streamed list), and what is above it may still be settling.
      poll = window.setInterval(step, 120);
    }

    const onScroll = () => {
      if (idle) window.clearTimeout(idle);
      idle = window.setTimeout(remember, PLACE_IDLE_MS);
    };
    // A press that may leave the page: the place is read now, while the page is still this one.
    const flush = () => {
      if (idle) remember();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointerdown", flush, { capture: true, passive: true });
    window.addEventListener("keydown", flush, { capture: true });
    window.addEventListener("pagehide", flush);
    return () => {
      window.clearTimeout(idle);
      window.clearInterval(poll);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointerdown", flush, { capture: true });
      window.removeEventListener("keydown", flush, { capture: true });
      window.removeEventListener("pagehide", flush);
    };
  }, [address]);

  return null;
}
