import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { Inbox, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  /** Rendered only when supplied — callers gate this on a permission check. */
  action?: { label: string; href: string };
  className?: string;
};

/**
 * The standard NESTO empty state (spec §59; design spec §30). Designed now so
 * that a module becoming functional is a matter of replacing the data, not the
 * layout.
 *
 * Two different problems share this look (AUD-05 §6, UX-11):
 * - first run — "No [records] yet", one sentence of purpose, and Create only
 *   when the caller has checked the permission; otherwise the description says
 *   how records reach this view, never "create one";
 * - no matching results — `NoResultsState` below, with Clear filters.
 */
export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      data-testid="empty-state"
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface-muted px-6 py-14 text-center",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="mb-3 flex size-10 items-center justify-center rounded-full border border-line bg-surface text-fg-subtle [&_svg]:size-5"
      >
        {icon ?? <Inbox />}
      </div>
      <p className="text-card font-semibold text-fg">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-table text-fg-muted">{description}</p>
      ) : null}
      {action ? (
        <Button asChild variant="secondary" size="sm" className="mt-4">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Search or filters returned nothing (AUD-05 §6, UX-11). It names the cause,
 * offers Clear filters back to the unfiltered list and never suggests creating
 * a record as the remedy: the data is there, the narrowing hides it.
 */
export function NoResultsState({
  noun,
  clearHref,
  className,
}: {
  /** Plural, lower case: "contractors", "daily logs". */
  noun: string;
  /** The same list without search or filters. */
  clearHref: string;
  className?: string;
}) {
  return (
    <div data-testid="no-results">
      <EmptyState
        icon={<SearchX />}
        title={`No ${noun} match these filters.`}
        description="Adjust or clear the search and filters to see more."
        action={{ label: "Clear filters", href: clearHref }}
        className={className}
      />
    </div>
  );
}

/** Query keys that page or order a list but never narrow it. */
const NON_NARROWING = new Set(["page", "pageSize", "limit", "sort", "dir", "order", "cursor", "tab"]);

/**
 * Whether search or filters narrow this list (AUD-05 §6, UX-11). With `keys`,
 * only those count — pass the toolbar's search and filter params so a view
 * default is not mistaken for a filter. Without, any non-empty key except
 * paging and sort counts.
 */
export function hasActiveFilters(
  params: Record<string, string | string[] | undefined>,
  keys?: readonly string[],
): boolean {
  const considered = keys ?? Object.keys(params).filter((key) => !NON_NARROWING.has(key));
  return considered.some((key) => {
    const value = params[key];
    return Array.isArray(value) ? value.some((entry) => entry.trim() !== "") : Boolean(value && value.trim() !== "");
  });
}

/**
 * Which empty answer a list owes (AUD-05 §6): rows, or nothing because the
 * filters hide it, or nothing at all yet. Loading is never one of these — a
 * list still loading renders its skeleton, not an empty answer.
 */
export function listEmptyKind(rowCount: number, filtered: boolean): "rows" | "no-results" | "first-run" {
  if (rowCount > 0) return "rows";
  return filtered ? "no-results" : "first-run";
}
