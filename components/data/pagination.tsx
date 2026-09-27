import Link from "@/components/navigation/nav-link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { PageSizeSelect } from "@/components/data/page-size-select";
import { pageHref, pageWindow, type SearchParamsInput } from "@/lib/modules/shared/list-query";
import { cn } from "@/lib/utils/cn";
import { UiNav, UiText } from "@/components/i18n/ui-text";

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

/**
 * Server-side pagination (PRD #7 §28, AUD-08 §4).
 *
 * The page number lives in the URL, so refresh, back/forward and a copied link
 * all land on the same records (PRD #7 §24). The count is the number of
 * matching authorized records, never the rows loaded: "1–25 of 73", and
 * "0 results" for an empty list — never "1–0" (AUD-08 §4, DT-05). A single
 * page still says how many records there are; only the Previous/Next
 * navigation is left out, since there is nowhere to go.
 *
 * Page links keep every other query key. Pass `buildHref`, or `searchParams`
 * (the page's own) with an optional `basePath` and the links are built with
 * `pageHref`, which preserves search, filters, section, sort and limit.
 *
 * `pageSizes` adds a Rows-per-page control offering exactly those sizes — only
 * sizes the module's parser accepts (AUD-08 §4) — remembered per list when a
 * `listId` is given.
 */
export function Pagination({
  meta,
  buildHref,
  searchParams,
  basePath = "",
  pageSizes,
  listId,
  limitParam = "limit",
  className,
}: {
  meta: PaginationMeta;
  buildHref?: (page: number) => string;
  searchParams?: SearchParamsInput;
  basePath?: string;
  pageSizes?: readonly number[];
  listId?: string;
  limitParam?: string;
  className?: string;
}) {
  const range = pageWindow(meta.total, meta.page, meta.limit);
  const href = buildHref ?? ((page: number) => pageHref(basePath, searchParams ?? {}, page));
  const showSizes = Boolean(pageSizes && pageSizes.length > 1 && range.total > Math.min(...pageSizes));

  const count =
    range.total === 0 ? (
      <p className="text-table text-fg-muted" aria-live="polite" data-testid="pagination-count">
        <span className="tabular-nums">0</span> <UiText k="results" />
      </p>
    ) : (
      <p className="text-table text-fg-muted" aria-live="polite" data-testid="pagination-count">
        <span className="tabular-nums">
          {range.from}–{range.to}
        </span>{" "}
        <UiText k="of" /> <span className="tabular-nums">{range.total}</span>
      </p>
    );

  const sizes =
    showSizes && pageSizes ? (
      <PageSizeSelect listId={listId} sizes={pageSizes} current={range.limit} param={limitParam} />
    ) : null;

  // One page: the count (and the size control, when useful), but no navigation
  // landmark — there is nowhere to navigate to.
  if (range.totalPages <= 1) {
    return <div className={cn("flex flex-wrap items-center justify-between gap-3 pt-1", className)}>{count}{sizes}</div>;
  }

  // 44px under a touch layout or pointer (AUD-04 §3, SP-04); desktop keeps h-9.
  const linkClass =
    "inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-table font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg touch:h-11";

  return (
    <UiNav
      k="pagination"
      className={cn("flex flex-wrap items-center justify-between gap-3 pt-1", className)}
    >
      {count}

      <div className="flex flex-wrap items-center gap-2">
        {sizes}
        {range.page > 1 ? (
          <Link href={href(range.page - 1)} rel="prev" className={linkClass}>
            <ChevronLeft aria-hidden="true" className="size-4" />
            <UiText k="previous" />
          </Link>
        ) : (
          <span className={cn(linkClass, "cursor-not-allowed opacity-50")} aria-disabled="true">
            <ChevronLeft aria-hidden="true" className="size-4" />
            <UiText k="previous" />
          </span>
        )}

        <span className="text-table tabular-nums text-fg-subtle">
          <UiText k="pageOf" values={{ page: range.page, total: range.totalPages }} />
        </span>

        {range.page < range.totalPages ? (
          <Link href={href(range.page + 1)} rel="next" className={linkClass}>
            <UiText k="next" />
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        ) : (
          <span className={cn(linkClass, "cursor-not-allowed opacity-50")} aria-disabled="true">
            <UiText k="next" />
            <ChevronRight aria-hidden="true" className="size-4" />
          </span>
        )}
      </div>
    </UiNav>
  );
}
