"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { useRouter } from "@/components/navigation/guarded-router";
import { useNavigationFeedback } from "@/components/navigation/navigation-feedback";
import { TableHeaderCell } from "@/components/ui/table";
import { applyListChange, queryHref, sameQuery } from "@/lib/tables/list-url";
import { appliedSort, headerSortState } from "@/lib/tables/sort";
import { cn } from "@/lib/utils/cn";

/**
 * How a table's header sort controls read and write the list's sort
 * (AUD-08 §4, DT-04, DT-19). `value` should be the sort the server parsed for
 * the rows on screen, so the header can never announce an order the rows do
 * not have; without it the URL value is used when it is allowlisted, else
 * `defaultValue`. `keys` is the module's allowlist (`CLIENT_SORT_KEYS`).
 */
export type TableSortConfig = {
  value?: string;
  keys?: readonly string[];
  defaultValue?: string;
  /** Query parameter the sort lives in. Defaults to `sort`, as in `ListToolbar`. */
  param?: string;
};

/**
 * A sortable column header: a real `<th>` with `aria-sort`, holding a button
 * that applies the column's next order through the URL — so Back, refresh and
 * a shared link reproduce it — and returns to page 1 (AUD-08 §3). Navigation
 * goes through the guarded router, so unsaved work is asked about first
 * (AUD-03 §5).
 */
export function SortHeaderCell({
  label,
  sortKey,
  sort,
  className,
  colId,
}: {
  label: string;
  sortKey: string;
  sort: TableSortConfig;
  className?: string;
  colId?: string;
}) {
  const router = useRouter();
  const feedback = useNavigationFeedback();
  const searchParams = useSearchParams();
  const param = sort.param ?? "sort";
  const [pending, startTransition] = React.useTransition();

  const applied = appliedSort(sort.value, searchParams.get(param), sort.keys, sort.defaultValue);
  const state = headerSortState(sortKey, applied, sort.keys);

  function activate() {
    if (!state.next || pending) return;
    const current = searchParams.toString();
    const query = applyListChange(current, { [param]: state.next });
    if (sameQuery(current, query)) return;
    const href = queryHref(query);
    feedback?.begin(href, "record");
    startTransition(() => router.push(href, { scroll: false }));
  }

  const Icon = state.ariaSort === "ascending" ? ArrowUp : state.ariaSort === "descending" ? ArrowDown : ArrowUpDown;

  return (
    <TableHeaderCell
      scope="col"
      aria-sort={state.ariaSort}
      data-col-id={colId}
      data-sort-key={sortKey}
      className={className}
    >
      <button
        type="button"
        onClick={activate}
        aria-disabled={state.next === null || undefined}
        data-pending={pending || undefined}
        title={state.next ? `Sort by ${label}` : undefined}
        className={cn(
          "-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase tracking-[0.08em] transition-colors",
          "hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          state.ariaSort !== "none" && "text-fg",
          state.next === null && "cursor-default",
        )}
      >
        {label}
        <Icon aria-hidden="true" className={cn("size-3.5", state.ariaSort === "none" && "opacity-50")} />
      </button>
    </TableHeaderCell>
  );
}
