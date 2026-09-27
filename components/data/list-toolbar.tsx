"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/components/navigation/guarded-router";

import { useNavigationFeedback } from "@/components/navigation/navigation-feedback";
import { SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { SearchField } from "@/components/ui/search-field";
import { applyListChange, clearListFilters, queryHref, sameQuery } from "@/lib/tables/list-url";
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
 *
 * AUD-08 §3 (DT-05, DT-20):
 * - changing search, a filter or the sort returns to page 1;
 * - Clear removes only this list's filter and search keys (plus any
 *   `extraFilterParams` the page filters by elsewhere) and keeps the section,
 *   sort, page size and every unrelated key;
 * - a change that yields the same query does nothing, so tabbing through an
 *   unchanged search box neither refetches nor throws the reader off page 3,
 *   and a submit followed by its own blur sends one request, not two;
 * - the controls show the applied state: `applied` carries the values the
 *   server parsed for the rows on screen (an invalid URL value shows what the
 *   parser actually used), and a URL value no option offers is not shown as
 *   chosen. Navigation is a transition, and App Router renders only the latest
 *   one, so an older response never replaces a newer query's rows.
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
  pageParam = "page",
  extraFilterParams = [],
  applied,
  className,
}: {
  searchPlaceholder?: string;
  searchParam?: string;
  filters?: FilterConfig[];
  sortOptions?: FilterOption[];
  sortParam?: string;
  pageParam?: string;
  /** Other query keys this list filters by (date ranges, chips) that Clear also removes. */
  extraFilterParams?: readonly string[];
  /** The effective values the server parsed, by param — the canonical applied state (AUD-08 §3). */
  applied?: Readonly<Record<string, string | undefined>>;
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

  // The last query this toolbar asked for, so a repeat of it while it is still
  // on its way is not sent twice.
  const lastPushed = React.useRef<string | null>(null);

  const navigate = React.useCallback(
    (query: string) => {
      const now = searchParams.toString();
      if (sameQuery(now, query)) return;
      if (pending && lastPushed.current !== null && sameQuery(lastPushed.current, query)) return;
      lastPushed.current = query;
      const href = queryHref(query);
      // A query change is a navigation too: it is marked until the new query commits (NAV-01 N05).
      feedback?.begin(href, "record");
      startTransition(() => router.push(href, { scroll: false }));
    },
    [router, searchParams, feedback, pending],
  );

  const apply = React.useCallback(
    (param: string, value: string) => {
      // Any change to the result set returns to the first page, otherwise the
      // reader lands on an empty page 3 of a shorter list.
      navigate(applyListChange(searchParams.toString(), { [param]: value }, pageParam));
    },
    [navigate, searchParams, pageParam],
  );

  // The box follows the URL when the URL's search changes (Back, Clear, a
  // link) — not on every other query change, which would overwrite typing.
  const urlSearch = current(searchParam);
  const [searchValue, setSearchValue] = React.useState(urlSearch);
  React.useEffect(() => setSearchValue(urlSearch), [urlSearch]);

  function submitSearch() {
    const value = searchValue.trim();
    if (value === urlSearch) return;
    apply(searchParam, value);
  }

  /** What a select shows: the applied value when the server gave one, else a URL value an option offers. */
  function selected(param: string, options: FilterOption[], allowEmpty: boolean): string {
    const offered = (value: string | undefined): value is string =>
      value !== undefined && ((allowEmpty && value === "") || options.some((option) => option.value === value));
    const fromServer = applied?.[param];
    if (offered(fromServer)) return fromServer;
    const fromUrl = current(param);
    if (offered(fromUrl)) return fromUrl;
    return allowEmpty ? "" : (options[0]?.value ?? "");
  }

  const activeFilters =
    filters.filter((filter) => current(filter.param) !== "").length +
    extraFilterParams.filter((param) => current(param) !== "").length;
  const hasActive = activeFilters > 0 || urlSearch !== "";

  function clearAll() {
    const keys = [...filters.map((filter) => filter.param), ...extraFilterParams, searchParam];
    navigate(clearListFilters(searchParams.toString(), keys, pageParam));
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
          submitSearch();
        }}
      >
        <SearchField
          name={searchParam}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          onBlur={submitSearch}
        />
      </form>

      {/* Wraps rather than running off the page: at tablet width a list with
          five filters and a sort is wider than the content column (AUD-01 §9). */}
      <div className="hidden min-w-0 flex-wrap items-center gap-2 md:flex">
        {filters.map((filter) => (
          <select
            key={filter.param}
            aria-label={filter.label}
            className={selectClass}
            value={selected(filter.param, filter.options, true)}
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
            value={selected(sortParam, sortOptions, false)}
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
                    value={selected(filter.param, filter.options, true)}
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
                    value={selected(sortParam, sortOptions, false)}
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
