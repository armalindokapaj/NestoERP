import type * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * The third sticky layer (Sticky Navigation §3, §9, §11): a page's context tabs,
 * pinned under the breadcrumb bar. Full width of the content column, opaque, with
 * a hairline under it. Put it as a direct child of the page's own container so
 * it stays pinned for the whole page. Pages without tabs render nothing (§12).
 */
export function ContextTabsFrame({ label, children, className, testId }: { label: string; children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <div
      data-context-tabs
      className={cn(
        "nesto-context-tabs",
        className,
      )}
    >
      {/* Phones may scroll the tabs sideways; desktop tab sets are kept short enough not to (§20). */}
      <div className="overflow-x-auto overscroll-x-contain">
        <nav aria-label={label} data-testid={testId} className="flex h-[2.875rem] min-w-max items-stretch gap-1 border-b border-line">
          {children}
        </nav>
      </div>
    </div>
  );
}

/** One tab's look, shared so every context tab set reads the same. */
export function contextTabClass(active: boolean) {
  return cn(
    "relative -mb-px inline-flex items-center gap-1 whitespace-nowrap border-b-2 px-3 text-table font-medium transition-colors touch:min-h-11",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
  );
}
