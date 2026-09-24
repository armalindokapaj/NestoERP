"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useNavigationFeedback } from "@/components/navigation/navigation-feedback";
import { SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/utils/cn";

/**
 * List search, filters and sort (PRD #7 §17, §24, §25, §27).
 *
 * Every control writes to the URL query string, so refresh, back/forward and a
 * shared link all reproduce the same list. Filter options are supplied by the
 * server already restricted to what the user may discover — a dropdown must
 * never name a record they cannot open (PRD #7 §26).
 *
 * On mobile the filters move into a sheet rather than crowding the header
 * (PRD #7 §88).
 */
export type FilterOption = { value: string; label: string };

export type FilterConfig = {
  /** Query-string parameter this filter writes. */
  param: string;
  label: string;
  options: FilterOption[];
};

export function ListToolbar({
  searchPlaceholder = "Search…",
  searchParam = "search",
  filters = [],
  sortOptions = [],
  sortParam = "sort",
  className,
}: {
  searchPlaceholder?: string;
  searchParam?: string;
  filters?: FilterConfig[];
  sortOptions?: FilterOption[];
  sortParam?: string;
  className?: string;
}) {
  const router = useRouter();
  const feedback = useNavigationFeedback();
  const searchParams = useSearchParams();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const current = React.useCallback(
    (param: string) => searchParams.get(param) ?? "",
    [searchParams],
  );

  const apply = React.useCallback(
    (param: string, value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value) next.set(param, value);
      else next.delete(param);
      // Any change to the result set returns to the first page, otherwise the
      // reader lands on an empty page 3 of a shorter list.
      next.delete("page");
      const query = next.toString();
      // A query change is a navigation too: it is marked until the new query commits (NAV-01 N05).
      feedback?.begin(query ? `?${query}` : "?", "record");
      startTransition(() => router.push(query ? `?${query}` : "?", { scroll: false }));
    },
    [router, searchParams, feedback],
  );

  const [searchValue, setSearchValue] = React.useState(current(searchParam));
  React.useEffect(() => setSearchValue(current(searchParam)), [current, searchParam]);

  const activeFilters = filters.filter((filter) => current(filter.param) !== "").length;
  const hasActive = activeFilters > 0 || current(searchParam) !== "";

  function clearAll() {
    const next = new URLSearchParams(searchParams.toString());
    for (const filter of filters) next.delete(filter.param);
    next.delete(searchParam);
    next.delete("page");
    const query = next.toString();
    feedback?.begin(query ? `?${query}` : "?", "record");
    startTransition(() => router.push(query ? `?${query}` : "?", { scroll: false }));
  }

  const selectClass =
    "h-10 rounded-md border border-line bg-surface px-3 text-table font-medium text-fg-muted transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} data-pending={pending}>
      <form
        role="search"
        className="min-w-0 flex-1 md:max-w-xs"
        onSubmit={(event) => {
          event.preventDefault();
          apply(searchParam, searchValue.trim());
        }}
      >
        <SearchField
          name={searchParam}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          onBlur={() => apply(searchParam, searchValue.trim())}
        />
      </form>

      <div className="hidden items-center gap-2 md:flex">
        {filters.map((filter) => (
          <select
            key={filter.param}
            aria-label={filter.label}
            className={selectClass}
            value={current(filter.param)}
            onChange={(event) => apply(filter.param, event.target.value)}
          >
            <option value="">{filter.label}</option>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ))}

        {sortOptions.length > 0 ? (
          <select
            aria-label="Sort"
            className={selectClass}
            value={current(sortParam)}
            onChange={(event) => apply(sortParam, event.target.value)}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : null}

        {hasActive ? (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <X aria-hidden="true" />
            Clear
          </Button>
        ) : null}
      </div>

      {filters.length > 0 || sortOptions.length > 0 ? (
        <Drawer open={open} onOpenChange={setOpen}>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-line bg-surface px-3 text-table font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg md:hidden"
          >
            <SlidersHorizontal aria-hidden="true" className="size-4" />
            Filters
            {activeFilters > 0 ? (
              <span className="rounded-full bg-accent px-1.5 text-micro text-accent-fg tabular-nums">
                {activeFilters}
              </span>
            ) : null}
          </button>

          <DrawerContent side="bottom">
            <DrawerTitle className="border-b border-line px-4 py-3 text-card font-semibold text-fg">
              Filters
            </DrawerTitle>
            <div className="flex flex-col gap-3 p-4">
              {filters.map((filter) => (
                <div key={filter.param} className="flex flex-col gap-1.5">
                  {/* An explicit label rather than a wrapping one: a select
                      inside a <label> takes its option text into its accessible
                      name, which turns "Status" into "StatusAllDraftActive…". */}
                  <label
                    htmlFor={`sheet-${filter.param}`}
                    className="text-table font-medium text-fg"
                  >
                    {filter.label}
                  </label>
                  <select
                    id={`sheet-${filter.param}`}
                    className={cn(selectClass, "w-full")}
                    value={current(filter.param)}
                    onChange={(event) => apply(filter.param, event.target.value)}
                  >
                    <option value="">All</option>
                    {filter.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}

              {sortOptions.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="sheet-sort" className="text-table font-medium text-fg">
                    Sort
                  </label>
                  <select
                    id="sheet-sort"
                    className={cn(selectClass, "w-full")}
                    value={current(sortParam)}
                    onChange={(event) => apply(sortParam, event.target.value)}
                  >
                    {sortOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="flex gap-2 pt-1">
                {hasActive ? (
                  <Button variant="secondary" className="flex-1" onClick={clearAll}>
                    Clear filters
                  </Button>
                ) : null}
                <Button className="flex-1" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      ) : null}
    </div>
  );
}
