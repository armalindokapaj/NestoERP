"use client";

import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Sticky regions (MOB-01 §25).
 *
 * A page never writes `top: 64px`. The shell publishes where its own sticky
 * layers end (`--nesto-sticky-top-offset`, styles/globals.css). Inside a
 * `StickyStack`, each region below that measures itself and pushes the next
 * one down, so a page can stack a header, a sub-header and tabs without any
 * of them overlapping — whatever their heights are at that width.
 *
 *   <StickyStack>
 *     <StickyHeader>…</StickyHeader>
 *     <StickySubHeader>…</StickySubHeader>
 *     <StickyTabs>…</StickyTabs>
 *   </StickyStack>
 *
 * Layers under the shell use z 10–27 (`--nesto-z-sticky` and below the shell's
 * 28); StickyActions is a bottom bar and is separate.
 */
type Level = "header" | "subheader" | "tabs";
const ORDER: Level[] = ["header", "subheader", "tabs"];

type StackContext = {
  /** Height of each registered level, px. */
  heights: Partial<Record<Level, number>>;
  report: (level: Level, height: number) => void;
};

const StickyStackContext = React.createContext<StackContext | null>(null);

export function StickyStack({ children }: { children: React.ReactNode }) {
  const [heights, setHeights] = React.useState<StackContext["heights"]>({});
  const report = React.useCallback((level: Level, height: number) => {
    setHeights((current) => (current[level] === height ? current : { ...current, [level]: height }));
  }, []);
  const value = React.useMemo(() => ({ heights, report }), [heights, report]);
  return <StickyStackContext.Provider value={value}>{children}</StickyStackContext.Provider>;
}

/** The offset (px) a level starts at, below the shell: the sum of the levels above it. */
export function stickyOffsetFor(level: Level, heights: StackContext["heights"]): number {
  let offset = 0;
  for (const above of ORDER.slice(0, ORDER.indexOf(level))) offset += heights[above] ?? 0;
  return offset;
}

const zByLevel: Record<Level, string> = { header: "z-[27]", subheader: "z-[26]", tabs: "z-[25]" };

function StickyRegion({ level, className, style, ...props }: React.ComponentProps<"div"> & { level: Level }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const stack = React.useContext(StickyStackContext);
  const report = stack?.report;

  React.useEffect(() => {
    const node = ref.current;
    if (!node || !report) return;
    report(level, node.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    // One observer per region, released on unmount: bounded, not global.
    const observer = new ResizeObserver(() => report(level, node.offsetHeight));
    observer.observe(node);
    return () => {
      observer.disconnect();
      report(level, 0);
    };
  }, [level, report]);

  const offset = stack ? stickyOffsetFor(level, stack.heights) : 0;
  return (
    <div
      ref={ref}
      data-sticky-region={level}
      className={cn("sticky bg-canvas", zByLevel[level], className)}
      style={{ top: `calc(var(--nesto-sticky-top-offset, 0px) + ${offset}px)`, ...style }}
      {...props}
    />
  );
}

export function StickyHeader(props: Omit<React.ComponentProps<"div">, "level">) {
  return <StickyRegion level="header" {...props} />;
}
export function StickySubHeader(props: Omit<React.ComponentProps<"div">, "level">) {
  return <StickyRegion level="subheader" {...props} />;
}
export function StickyTabs(props: Omit<React.ComponentProps<"div">, "level">) {
  return <StickyRegion level="tabs" {...props} />;
}

/**
 * The bottom action bar (Save / Submit / Approve). Sticks to the bottom on a
 * phone, clear of the home indicator; from md it sits in the page flow.
 * `data-sticky-action-bar` is what makes toasts and focus scrolling keep clear
 * of it (globals.css), so use this instead of a hand-made bar.
 */
export function StickyActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-sticky-action-bar
      className={cn(
        "flex flex-wrap items-center justify-end gap-2",
        "sticky bottom-0 z-30 -mx-[var(--nesto-space-page-x)] border-t border-line bg-surface/95 px-[var(--nesto-space-page-x)] pt-3 pb-[calc(0.75rem+var(--nesto-safe-bottom))] backdrop-blur",
        "md:static md:z-auto md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-3 md:backdrop-blur-none",
        className,
      )}
      {...props}
    />
  );
}
