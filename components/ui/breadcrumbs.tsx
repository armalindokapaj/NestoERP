import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * Breadcrumbs (design spec §64).
 *
 * Deep pages only. Top-level module pages must not render these — the sidebar
 * already says where you are.
 */
export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex flex-wrap items-center gap-1 text-table text-fg-muted">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="truncate rounded-sm transition-colors hover:text-fg"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className={cn("truncate", last && "font-medium text-fg")}
                >
                  {item.label}
                </span>
              )}
              {last ? null : (
                <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
