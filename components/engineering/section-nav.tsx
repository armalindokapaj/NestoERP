"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";

/**
 * A workspace's own navigation (PRD #46 §8, §10, §165). As a column beside a
 * register on a desk and a row of pills on a phone, or as a row of tabs
 * throughout. The current section is the longest route that matches, so a
 * record page keeps its register highlighted.
 */
export function SectionNav({ items, label, testId, layout = "column" }: { items: Array<{ href: string; label: string; count?: number | null; exact?: boolean }>; label: string; testId?: string; layout?: "column" | "tabs" }) {
  const pathname = usePathname();
  const active = items
    .filter((item) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  if (layout === "tabs") {
    return (
      <div className="-mx-1 overflow-x-auto">
        <nav aria-label={label} data-testid={testId} className="flex min-w-max items-center gap-1 border-b border-line px-1">
          {items.map((item) => {
            const current = item.href === active;
            return (
              <Link key={item.href} href={item.href} aria-current={current ? "page" : undefined} className={cn("-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-table font-medium transition-colors", current ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg")}>
                {item.label}
                {item.count ? <span className="rounded-full bg-surface-muted px-1.5 text-meta tabular-nums text-fg-muted">{item.count}</span> : null}
              </Link>
            );
          })}
        </nav>
      </div>
    );
  }

  return (
    <nav aria-label={label} data-testid={testId} className="-mx-1 overflow-x-auto lg:mx-0 lg:overflow-visible">
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
                  "max-lg:min-h-10 max-lg:rounded-full max-lg:border max-lg:border-line max-lg:py-1.5",
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
  );
}
