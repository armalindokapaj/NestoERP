import type * as React from "react";

import { RegisterSections } from "@/components/navigation/section-registry";
import type { SectionItem } from "@/components/navigation/section-store";
import { cn } from "@/lib/utils/cn";

/**
 * The third sticky layer (Sticky Navigation §3, §9, §11): a page's context tabs,
 * pinned under the breadcrumb bar. Full width of the content column, opaque, with
 * a hairline under it. Put it as a direct child of the page's own container so
 * it stays pinned for the whole page. Pages without tabs render nothing (§12).
 *
 * One row at every width from `lg`: 46px (`--nesto-shell-tab-row-h`). Where
 * the tabs outgrow the row it scrolls sideways.
 *
 * Below `lg` (phones and tablets) the row is not drawn: its `sections` — every
 * tab, including those a row tucks under More — are the top bar's section menu
 * (components/layout/section-menu.tsx). A page's own controls (`trailing`)
 * stay on the page there, a compact right-aligned row in the tab row's place
 * that scrolls with it (`data-tabs-in-menu`, styles/globals.css). `lead` is
 * what names the context in that row below `lg` — a project's name, code,
 * company and status — so the name and the controls share one line. Neither
 * is drawn from `lg`, where the row is the tabs alone and a page's controls
 * are in its own header (a project's Overview: its hero).
 */
export function ContextTabsFrame({
  label,
  sections,
  children,
  className,
  testId,
  trailing,
  lead,
}: {
  label: string;
  /** The row's tabs as data, for the section menu: the same tabs, in the same order, with the one the page is on marked. */
  sections: readonly SectionItem[];
  children: React.ReactNode;
  className?: string;
  testId?: string;
  trailing?: React.ReactNode;
  /** Below lg only: the context's own compact header, at the start of the row. Its own classes say where it shows (it carries `lg:hidden` or narrower). */
  lead?: React.ReactNode;
}) {
  const scroller = (
    // Desktop tab sets are kept short enough not to scroll (§20); below lg the row is the section menu instead.
    <div className={cn("overflow-x-auto overscroll-x-contain max-lg:hidden", trailing ? "min-w-0 flex-1" : null)} data-tab-scroller>
      <nav aria-label={label} data-testid={testId} className="flex h-(--nesto-shell-tab-row-h) min-w-max items-stretch gap-1 border-b border-line">
        {children}
      </nav>
    </div>
  );
  const leading = lead ? (
    <div className="flex min-w-0 flex-1 items-center lg:hidden" data-context-tabs-lead>
      {lead}
    </div>
  ) : null;
  return (
    <div data-context-tabs data-tabs-in-menu className={cn("nesto-context-tabs", className)}>
      <RegisterSections label={label} items={sections} />
      {trailing ? (
        // A page's own controls at the end of the compact row below lg; from lg the row is the tabs alone.
        <div className="flex items-stretch max-lg:justify-end max-lg:gap-2">
          {leading}
          {scroller}
          <div className="flex h-(--nesto-shell-tab-row-h) shrink-0 items-center gap-1 lg:hidden" data-context-tabs-trailing>
            {trailing}
          </div>
        </div>
      ) : (
        <>
          {leading}
          {scroller}
        </>
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
    // The reference's segmented pills, the tab the page is on in ink.
    "my-auto h-9 rounded-full border-b-0 px-3.5",
    active ? "bg-primary text-primary-fg" : "hover:bg-hover",
  );
}
