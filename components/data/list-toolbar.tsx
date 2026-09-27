"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/components/navigation/guarded-router";

import { useNavigationFeedback } from "@/components/navigation/navigation-feedback";
import { X } from "lucide-react";

import { FilterChips } from "@/components/data/filter-chips";
import { FilterSheet } from "@/components/data/filter-sheet";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import {
  appliedDraftQuery,
  appliedFilterValue,
  filterChips,
  removeFilterQuery,
  type FilterConfig,
  type FilterDraft,
  type FilterOption,
} from "@/lib/tables/filter-draft";
import { applyListChange, clearListFilters, queryHref, sameQuery } from "@/lib/tables/list-url";

export type { FilterConfig, FilterOption } from "@/lib/tables/filter-draft";

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
 *
 * Phones (AUD-04 §5, MW-06, MW-16), below `md`; the inline controls from `md`
 * up are unchanged:
 * - Search stays immediate (Enter, or leaving the box with a changed value).
 * - Sort is its own labelled select beside Filters, applied at once — it is
 *   not a filter, and it is marked so a table's own phone Sort steps aside.
 * - Filters open a staged sheet (`FilterSheet`: Apply / Cancel / Clear), and
 *   the applied filters show under the toolbar as removable chips with Clear
 *   all (`FilterChips`). The badge and the chips count the same thing: the
 *   filters actually applied, plus other list keys set on the page.
 * - Everything is one tree whose layout CSS switches, so turning the phone
 *   keeps the typed search, an open sheet and its draft, and sends nothing.
 */

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
  const [pending, startTransition] = React.useTransition();
  const controlId = React.useId();

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
    return appliedFilterValue(options, applied?.[param], current(param), allowEmpty);
  }
  const appliedValue = (filter: FilterConfig) => selected(filter.param, filter.options, true);

  // The chips and the badge count what is applied: a URL value no option
  // offers was not applied by the server, so it is neither.
  const chips = filterChips(filters, appliedValue);
  const extraActive = extraFilterParams.filter((param) => current(param) !== "").length;
  const activeFilters = chips.length + extraActive;
  const hasActive =
    urlSearch !== "" || extraActive > 0 || filters.some((filter) => current(filter.param) !== "");

  function clearAll() {
    const keys = [...filters.map((filter) => filter.param), ...extraFilterParams, searchParam];
    navigate(clearListFilters(searchParams.toString(), keys, pageParam));
  }

  function applyDraft(draft: FilterDraft) {
    navigate(appliedDraftQuery(searchParams.toString(), filters, draft, pageParam));
  }

  function removeChip(param: string) {
    navigate(removeFilterQuery(searchParams.toString(), param, pageParam));
  }

  const selectClass =
    "h-10 rounded-md border border-line bg-surface px-3 text-table font-medium text-fg-muted transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20 touch:min-h-11";

  return (
    <div className={className} data-pending={pending}>
    <div className="flex flex-wrap items-center gap-2">
      <form
        role="search"
        className="min-w-0 flex-1 max-md:basis-full md:max-w-xs"
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

      {/* Phone Sort: labelled, applied at once, showing the applied order. */}
      {sortOptions.length > 0 ? (
        <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden" data-list-sort-control>
          <label htmlFor={`${controlId}-sort`} className="shrink-0 text-table font-medium text-fg-subtle">
            Sort
          </label>
          <select
            id={`${controlId}-sort`}
            className="h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-base font-medium text-fg-muted transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20"
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

      {filters.length > 0 ? (
        <FilterSheet filters={filters} applied={appliedValue} activeCount={activeFilters} onApply={applyDraft} />
      ) : null}
    </div>

      {/* Phone: what is applied, each removable, and Clear all. */}
      {hasActive ? (
        <FilterChips chips={chips} onRemove={removeChip} onClearAll={clearAll} className="mt-1 md:hidden" />
      ) : null}
    </div>
  );
}
