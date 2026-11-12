import * as React from "react";
import { ChevronLeft, ChevronRight } from "@/components/icons";

import { MobileRecordRow, type MobileRecordProps } from "@/components/data/mobile-record";
import { ContextTabsFrame, contextTabClass } from "@/components/navigation/context-tabs-frame";
import Link from "@/components/navigation/nav-link";
import { cn } from "@/lib/utils/cn";

/*
 * The Admin Console's list and record pieces (docs/ui/UI-09-admin-console.md §Lists),
 * drawn as the company app draws its own: a lined frame, tabs in the context
 * tab row (the phone's section row below lg), choices as one segmented
 * control, the table from md and compact lines on a phone, and a foot with
 * the count and the pages.
 */

export type AdminTab = { key: string; label: string; href: string; active: boolean; testId?: string };

/** A page's or a record's tabs, in the context tab row from lg and the phone's section row below it. */
export function AdminTabs({ label, tabs, testId }: { label: string; tabs: AdminTab[]; testId?: string }) {
  return (
    <ContextTabsFrame label={label} testId={testId} sections={tabs.map((tab) => ({ key: tab.key, label: tab.label, href: tab.href, active: tab.active }))}>
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} scroll={false} navSource="tab" aria-current={tab.active ? "page" : undefined} data-testid={tab.testId} className={contextTabClass(tab.active)}>
          {tab.label}
        </Link>
      ))}
    </ContextTabsFrame>
  );
}

export type AdminChoiceOption = { key: string; label: string; href: string; active: boolean };

/** One filter's choices as a segmented control: square cells sharing their lines, the chosen one in ink. */
export function AdminChoice({ label, options, testId }: { label: string; options: AdminChoiceOption[]; testId?: string }) {
  return (
    <nav aria-label={label} data-testid={testId} className="flex max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="flex shrink-0 border border-line-strong bg-surface">
        {options.map((option) => (
          <li key={option.key || "any"} className="border-r border-line last:border-r-0">
            <Link
              href={option.href}
              replace
              scroll={false}
              aria-current={option.active ? "true" : undefined}
              className={cn(
                "flex h-9 items-center whitespace-nowrap px-3 text-table font-medium transition-colors touch:h-11",
                option.active ? "bg-primary text-primary-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
              )}
            >
              {option.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The search and filters above a list, on one line that wraps. */
export function AdminToolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

/**
 * A list in a lined frame: `table` from md, `lines` (compact rows, as Sales
 * units' on a phone) below it; `empty` instead of both when there is nothing;
 * `foot` under it.
 */
export function AdminListFrame({ label, testId, table, lines, empty, foot }: { label: string; testId?: string; table: React.ReactNode; lines: MobileRecordProps[]; empty?: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <section aria-label={label} data-testid={testId} className="min-w-0 border border-line-strong bg-surface">
      {empty ?? (
        <>
          <div className="min-w-0 overflow-x-auto max-md:hidden">{table}</div>
          <ul className="md:hidden" aria-label={label}>
            {lines.map((line, index) => (
              <MobileRecordRow key={index} {...line} />
            ))}
          </ul>
        </>
      )}
      {foot}
    </section>
  );
}

/** The count, and Previous · page n of m · Next when there is more than one page. */
export function AdminListFoot({ count, page, pages, previousHref, nextHref, words }: { count: string; page: number; pages: number; previousHref: string; nextHref: string; words: { pages: string; previous: string; next: string; pageOf: string } }) {
  const step = "inline-grid size-9 place-items-center border border-line-strong text-fg transition-colors hover:bg-hover touch:size-11";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-strong px-4 py-2">
      <span className="font-mono text-micro font-medium uppercase tracking-[0.1em] text-fg-muted">{count}</span>
      {pages > 1 ? (
        <nav aria-label={words.pages} className="flex items-center gap-2">
          {page > 1 ? (
            <Link href={previousHref} scroll={false} aria-label={words.previous} className={step}>
              <ChevronLeft aria-hidden="true" className="size-4" />
            </Link>
          ) : null}
          <span className="font-mono text-micro uppercase tracking-[0.1em] text-fg-muted">{words.pageOf}</span>
          {page < pages ? (
            <Link href={nextHref} scroll={false} aria-label={words.next} className={step}>
              <ChevronRight aria-hidden="true" className="size-4" />
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
