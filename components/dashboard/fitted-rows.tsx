"use client";

import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * A list that shows only the rows that fit its height — whole rows, never one
 * cut through — and says when it left any out.
 *
 * The fitting is CSS: the list is a wrapping column, so a row with no room left
 * wraps into a second column, and that column is clipped. The script only
 * notices that it happened, so `more` (a link to the rest) can be shown. Where
 * the height is not held — a phone, where the list simply grows — every row
 * shows and `more` appears only when `always` asks for it.
 */
export function FittedRows({
  children,
  more,
  always = false,
  className,
}: {
  /** `<li className="w-full">` rows: full width, so a row that wraps starts a new column. */
  children: React.ReactNode;
  /** Shown under the list when rows were left out. */
  more: React.ReactNode;
  /** Show `more` even when every row fits — the list is known to be only the first few. */
  always?: boolean;
  className?: string;
}) {
  const list = React.useRef<HTMLUListElement>(null);
  const [clipped, setClipped] = React.useState(false);

  React.useEffect(() => {
    const element = list.current;
    if (!element) return;
    // A wrapped row sits in a column beyond the list's own width.
    const check = () => setClipped(element.scrollWidth > element.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)} data-clipped={clipped || undefined}>
      <ul ref={list} className="flex min-h-0 flex-1 flex-col flex-wrap content-start overflow-hidden">
        {children}
      </ul>
      {clipped || always ? <div className="shrink-0">{more}</div> : null}
    </div>
  );
}
