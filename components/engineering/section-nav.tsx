"use client";

import Link from "@/components/navigation/nav-link";
import { usePathname } from "next/navigation";

import { ContextTabsFrame, contextTabClass } from "@/components/navigation/context-tabs-frame";
import { RegisterSections } from "@/components/navigation/section-registry";
import { cn } from "@/lib/utils/cn";

/**
 * A workspace's own navigation (PRD #46 §8, §10, §165). As a column beside a
 * register on a desk, or as a row of tabs throughout. The current section is
 * the longest route that matches, so a record page keeps its register
 * highlighted.
 *
 * Below `lg` (phones and tablets) neither is drawn: the sections are the
 * phone's section row (components/layout/phone-sections.tsx), with the way
 * back to the project's Engineering at its start, like every other tab row.
 */
export function SectionNav({ items, label, testId, layout = "column" }: { items: Array<{ href: string; label: string; count?: number | null; exact?: boolean }>; label: string; testId?: string; layout?: "column" | "tabs" }) {
  const pathname = usePathname();
  const active = items
    .filter((item) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const sections = items.map((item) => ({ key: item.href, label: item.label, href: item.href, active: item.href === active, count: item.count ?? null }));

  if (layout === "tabs") {
    return (
      <ContextTabsFrame label={label} testId={testId} sections={sections}>
        {items.map((item) => {
          const current = item.href === active;
          return (
            <Link key={item.href} href={item.href} aria-current={current ? "page" : undefined} className={cn(contextTabClass(current), "gap-2")}>
              {item.label}
              {item.count ? <span className="rounded-full bg-surface-muted px-1.5 text-meta tabular-nums text-fg-muted">{item.count}</span> : null}
            </Link>
          );
        })}
      </ContextTabsFrame>
    );
  }

  return (
    <>
      <RegisterSections label={label} items={sections} />
      <nav aria-label={label} data-testid={testId} className="-mx-1 overflow-x-auto max-lg:hidden lg:mx-0 lg:overflow-visible">
      <ul className="flex min-w-max gap-1 px-1 lg:min-w-0 lg:flex-col lg:px-0">
        {items.map((item) => {
          const current = item.href === active;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between gap-3 whitespace-nowrap rounded-md px-3 py-2 text-table transition-colors",
                  current ? "bg-hover font-medium text-fg" : "text-fg-muted hover:bg-hover/60 hover:text-fg",
                  "max-lg:min-h-11 max-lg:rounded-full max-lg:border max-lg:border-line max-lg:py-1.5",
                  current && "max-lg:border-line-strong",
                )}
              >
                <span>{item.label}</span>
                {item.count ? <span className="rounded-full bg-surface-muted px-1.5 text-meta tabular-nums text-fg-muted">{item.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
      </nav>
    </>
  );
}
