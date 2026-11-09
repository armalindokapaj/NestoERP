import type * as React from "react";

import { ContextTabsOverflow } from "@/components/navigation/context-tabs-overflow";
import { RegisterSections } from "@/components/navigation/section-registry";
import type { SectionItem } from "@/components/navigation/section-store";
import { cn } from "@/lib/utils/cn";

/**
 * The third sticky layer (Sticky Navigation §3, §9, §11): a page's context tabs,
 * pinned under the breadcrumb bar. Full width of the content column, opaque, with
 * a hairline under it. Put it as a direct child of the page's own container so
 * it stays pinned for the whole page. Pages without tabs render nothing (§12).
 *
 * One row at every width from `lg`: 46px, and in version 2 40px, 44px under
 * touch (`--nesto-shell-tab-row-h`; UI-02 §7). Where the tabs outgrow the row
 * it scrolls sideways, and version 2 marks the edge they continue past (§24).
 *
 * Below `lg` (phones and tablets) the row is not drawn: its `sections` — every
 * tab, including those a row tucks under More — are the top bar's section menu
 * (components/layout/section-menu.tsx). A page's own controls (`trailing`)
 * stay on the page there, a compact right-aligned row in the tab row's place
 * that scrolls with it (`data-tabs-in-menu`, styles/globals.css).
 */
export function ContextTabsFrame({
  label,
  sections,
  children,
  className,
  testId,
  trailing,
}: {
  label: string;
  /** The row's tabs as data, for the section menu: the same tabs, in the same order, with the one the page is on marked. */
  sections: readonly SectionItem[];
  children: React.ReactNode;
  className?: string;
  testId?: string;
  trailing?: React.ReactNode;
}) {
  const scroller = (
    // Desktop tab sets are kept short enough not to scroll (§20); below lg the row is the section menu instead.
    <div className={cn("overflow-x-auto overscroll-x-contain max-lg:hidden", trailing ? "min-w-0 flex-1" : null)} data-tab-scroller>
      <nav aria-label={label} data-testid={testId} className="flex h-(--nesto-shell-tab-row-h) min-w-max items-stretch gap-1 border-b border-line">
        {children}
      </nav>
      <ContextTabsOverflow />
    </div>
  );
  return (
    <div data-context-tabs data-tabs-in-menu className={cn("nesto-context-tabs", className)}>
      <RegisterSections label={label} items={sections} />
      {trailing ? (
        // A page's own controls at the row's end: outside the scroller, so they stay in view while the tabs scroll, on the same hairline.
        <div className="flex items-stretch max-lg:justify-end">
          {scroller}
          <div className="flex h-(--nesto-shell-tab-row-h) shrink-0 items-center gap-1 border-b border-line pl-2 max-lg:border-b-0 max-lg:pl-0" data-context-tabs-trailing>
            {trailing}
          </div>
        </div>
      ) : (
        scroller
      )}
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
