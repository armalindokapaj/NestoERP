import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

/**
 * Server-side pagination (PRD #7 §28).
 *
 * The page number lives in the URL, so refresh, back/forward and a copied link
 * all land on the same records (PRD #7 §24).
 */
export function Pagination({
  meta,
  buildHref,
  className,
}: {
  meta: PaginationMeta;
  buildHref: (page: number) => string;
  className?: string;
}) {
  if (meta.totalPages <= 1) return null;

  const first = (meta.page - 1) * meta.limit + 1;
  const last = Math.min(meta.page * meta.limit, meta.total);

  const linkClass =
    "inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-table font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg";

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex flex-wrap items-center justify-between gap-3 pt-1", className)}
    >
      <p className="text-table text-fg-muted">
        <span className="tabular-nums">
          {first}–{last}
        </span>{" "}
        of <span className="tabular-nums">{meta.total}</span>
      </p>

      <div className="flex items-center gap-2">
        {meta.page > 1 ? (
          <Link href={buildHref(meta.page - 1)} rel="prev" className={linkClass}>
            <ChevronLeft aria-hidden="true" className="size-4" />
            Previous
          </Link>
        ) : (
          <span className={cn(linkClass, "cursor-not-allowed opacity-50")} aria-disabled="true">
            <ChevronLeft aria-hidden="true" className="size-4" />
            Previous
          </span>
        )}

        <span className="text-table tabular-nums text-fg-subtle">
          Page {meta.page} of {meta.totalPages}
        </span>

        {meta.page < meta.totalPages ? (
          <Link href={buildHref(meta.page + 1)} rel="next" className={linkClass}>
            Next
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        ) : (
          <span className={cn(linkClass, "cursor-not-allowed opacity-50")} aria-disabled="true">
            Next
            <ChevronRight aria-hidden="true" className="size-4" />
          </span>
        )}
      </div>
    </nav>
  );
}
