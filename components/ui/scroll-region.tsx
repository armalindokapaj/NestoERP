"use client";

import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * A labelled, bounded horizontal scroll region (AUD-04 §3, §5; SP-02, MW-05).
 *
 * Deliberately two-dimensional content — a wide financial table, a quantity
 * grid, a timeline — pans inside this box instead of scrolling the page. It is
 * a named region, so a screen reader announces what scrolls, and while its
 * content is wider than the box it takes keyboard focus (tabIndex 0), so arrow
 * keys scroll it without a mouse or a swipe. When everything fits it is not a
 * tab stop, so desktop keyboard order is unchanged (MW-21).
 *
 * It starts focusable, on the server too, and drops out of the tab order once
 * a measurement shows nothing to scroll: the markup is the same on both sides
 * of hydration. `data-overflowing` is set while there is something to scroll.
 *
 * Use it for every hand-rolled `overflow-x-auto` wrapper (RC-6); the Table
 * primitive already does.
 */
export function ScrollRegion({
  label,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "role" | "tabIndex"> & {
  /** What scrolls, e.g. "Invoice lines". Required: an unnamed region is noise. */
  label: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = React.useState(true);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setOverflowing(element.scrollWidth > element.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      tabIndex={overflowing ? 0 : undefined}
      data-overflowing={overflowing || undefined}
      className={cn(
        "w-full overflow-x-auto overscroll-x-contain",
        // The outside outline would be clipped by the scroll box: the ring is drawn inside.
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Keeps the active item of a horizontally scrolling strip (tabs, section
 * links) in view: on mount and whenever `activeKey` changes it scrolls the
 * nearest horizontal scroller so the `[aria-current=page]` or
 * `[data-state=active]` element is visible, without moving the page vertically
 * (AUD-04 §4, SP-09).
 */
export function KeepActiveInView({ activeKey }: { activeKey: string }) {
  const marker = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    let scroller: HTMLElement | null = marker.current?.parentElement ?? null;
    while (scroller && getComputedStyle(scroller).overflowX !== "auto" && getComputedStyle(scroller).overflowX !== "scroll") {
      scroller = scroller.parentElement;
    }
    if (!scroller) return;
    const active = scroller.querySelector<HTMLElement>('[aria-current="page"], [data-state="active"]');
    if (!active) return;
    const box = scroller.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    if (item.left < box.left) scroller.scrollLeft -= box.left - item.left + 16;
    else if (item.right > box.right) scroller.scrollLeft += item.right - box.right + 16;
  }, [activeKey]);
  return <span ref={marker} hidden />;
}
