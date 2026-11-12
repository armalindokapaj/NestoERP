"use client";

import * as React from "react";
import { ChevronLeft, ExternalLink } from "@/components/icons";

import Link from "@/components/navigation/nav-link";
import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";
import { useSectionLevels } from "@/components/navigation/section-registry";
import { menuLevels, type SectionItem } from "@/components/navigation/section-store";
import { emitNavigationEvent } from "@/lib/navigation/analytics";
import { cn } from "@/lib/utils/cn";

/**
 * The page's sections below `lg` (docs/ui/UI-04-navigation-layouts.md §Phone):
 * a row under the top bar, pinned as you scroll, glass (60% of the page and a
 * 12px blur), the one you are on underlined in gold. Visible, not in a menu:
 * the last one is cut by the edge, so you can see there are more.
 *
 * The sections are the ones the page's own tab rows registered
 * (components/navigation/section-registry.tsx) — from `lg` those rows are
 * drawn in the page; below it, this row is. Inside a record that has its own
 * sections (a unit inside its project) the row is the record's, with the way
 * back to the section it sits in at its start.
 */
export function PhoneSections() {
  const levels = menuLevels(useSectionLevels());
  const row = React.useRef<HTMLDivElement>(null);
  const level = levels[levels.length - 1];
  const parent = levels.length > 1 ? levels[levels.length - 2]!.items.find((item) => item.active) ?? null : null;
  const active = level?.items.find((item) => item.active)?.key ?? null;

  // The section you are on is in view, however far along the row it is.
  React.useLayoutEffect(() => {
    const scroller = row.current;
    const current = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!scroller || !current) return;
    scroller.scrollLeft = Math.max(0, current.offsetLeft - scroller.clientWidth / 3);
  }, [active, level?.id]);

  // Until the page's rows register (after hydration), its place is held when the page has sections (styles/globals.css).
  if (!level) return <div aria-hidden="true" data-phone-sections-placeholder="" className="sticky top-(--nesto-shell-header-h) z-(--nesto-z-shell-tabs) h-12 border-b border-line-strong bg-canvas/60 backdrop-blur-[12px]" />;
  return (
    <nav aria-label={level.label} data-phone-sections="" data-testid="phone-sections" className="sticky top-(--nesto-shell-header-h) z-(--nesto-z-shell-tabs) h-12 border-b border-line-strong lg:hidden">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-canvas/60 backdrop-blur-[12px]" />
      <div ref={row} className="flex h-full items-stretch overflow-x-auto overscroll-x-contain px-1 [scrollbar-width:none] sm:px-3 [&::-webkit-scrollbar]:hidden">
        {parent ? (
          <Link href={parent.href} navSource="tab" className="flex shrink-0 items-center gap-1 border-r border-line pl-2 pr-3.5 text-table font-medium text-fg-subtle hover:text-fg" data-testid="phone-sections-up">
            <ChevronLeft aria-hidden="true" className="size-4" />
            {parent.label}
          </Link>
        ) : null}
        {level.items.map((item) => (
          <Section key={item.key} item={item} />
        ))}
      </div>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-r from-transparent to-canvas" />
    </nav>
  );
}

function Section({ item }: { item: SectionItem }) {
  const pending = usePendingDestination(item.newTab ? null : item.href);
  return (
    <Link
      href={item.href}
      navSource="tab"
      target={item.newTab ? "_blank" : undefined}
      rel={item.newTab ? "noopener noreferrer" : undefined}
      aria-current={item.active ? "page" : undefined}
      data-pending={pending || undefined}
      onClick={() => emitNavigationEvent("navigation_destination_opened", { section: item.key, source: "phone_sections" })}
      className={cn(
        "relative flex shrink-0 items-center gap-1.5 px-3.5 text-table font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        item.active ? "text-fg after:absolute after:inset-x-3.5 after:bottom-0 after:h-0.5 after:bg-accent" : "text-fg-subtle hover:text-fg",
      )}
    >
      {item.label}
      {item.count ? <span className="font-mono text-meta tabular-nums text-fg-subtle">{item.count}</span> : null}
      {item.newTab ? <ExternalLink aria-hidden="true" className="size-3.5 text-fg-subtle" /> : null}
      {pending ? <PendingDot className="text-accent" /> : null}
    </Link>
  );
}
