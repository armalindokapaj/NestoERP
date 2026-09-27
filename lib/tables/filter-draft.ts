import { applyListChange } from "@/lib/tables/list-url";

/**
 * The staged filter model for the phone filter sheet (AUD-04 §5, MW-06).
 *
 * One apply model, copied from the approvals filter drawer
 * (`components/approvals/approval-filters.tsx`) and made generic:
 * - the sheet opens with a draft of the applied values;
 * - changing a field changes only the draft;
 * - Apply writes the whole draft to the URL at once (one navigation, page 1);
 * - Cancel, Escape or the backdrop drop the draft, so the applied values stand;
 * - Clear empties the draft's fields, still only until Apply;
 * - outside the sheet, each applied filter is a removable chip, and Clear all
 *   resets the results at once.
 *
 * Kept pure so the rules are tested without a browser. The URL stays the
 * applied state (AUD-08 §3): nothing here remembers a value of its own.
 */

export type FilterOption = { value: string; label: string };

export type FilterConfig = {
  /** Query-string parameter this filter writes. */
  param: string;
  label: string;
  options: FilterOption[];
};

/** Filter values by param; "" is "All". */
export type FilterDraft = Record<string, string>;

/**
 * What a filter shows as chosen: the value the server parsed for the rows on
 * screen when an option offers it, else a URL value an option offers, else
 * "" (All) — or, where "" is not allowed (a sort), the first option. A URL
 * value no option offers is never shown as chosen (AUD-08 §3).
 */
export function appliedFilterValue(
  options: readonly FilterOption[],
  fromServer: string | undefined,
  fromUrl: string | null | undefined,
  allowEmpty = true,
): string {
  const offered = (value: string | null | undefined): value is string =>
    value !== undefined && value !== null && ((allowEmpty && value === "") || options.some((option) => option.value === value));
  if (offered(fromServer)) return fromServer;
  if (offered(fromUrl)) return fromUrl;
  return allowEmpty ? "" : (options[0]?.value ?? "");
}

/** The draft a sheet opens with: every filter's applied value. */
export function draftFromApplied(filters: readonly FilterConfig[], applied: (filter: FilterConfig) => string): FilterDraft {
  const draft: FilterDraft = {};
  for (const filter of filters) draft[filter.param] = applied(filter);
  return draft;
}

/** Clear inside the sheet: every field back to All, still staged. */
export function clearedDraft(filters: readonly FilterConfig[]): FilterDraft {
  const draft: FilterDraft = {};
  for (const filter of filters) draft[filter.param] = "";
  return draft;
}

/** The draft with one field changed. A value no option offers is refused. */
export function setDraftValue(draft: FilterDraft, filter: FilterConfig, value: string): FilterDraft {
  if (value !== "" && !filter.options.some((option) => option.value === value)) return draft;
  return { ...draft, [filter.param]: value };
}

/** How many fields of the draft narrow the list. */
export function draftCount(filters: readonly FilterConfig[], draft: FilterDraft): number {
  return filters.filter((filter) => (draft[filter.param] ?? "") !== "").length;
}

/** Whether the draft differs from what is applied. */
export function draftChanged(filters: readonly FilterConfig[], draft: FilterDraft, applied: FilterDraft): boolean {
  return filters.some((filter) => (draft[filter.param] ?? "") !== (applied[filter.param] ?? ""));
}

/**
 * The query Apply navigates to: every filter param set from the draft (or
 * removed for All), every other key kept, and back to page 1. Filters the
 * draft does not name are left as they are.
 */
export function appliedDraftQuery(
  query: string | URLSearchParams,
  filters: readonly FilterConfig[],
  draft: FilterDraft,
  pageParam = "page",
): string {
  const changes: Record<string, string | null> = {};
  for (const filter of filters) {
    if (!(filter.param in draft)) continue;
    changes[filter.param] = draft[filter.param] || null;
  }
  return applyListChange(query, changes, pageParam);
}

export type FilterChip = { param: string; label: string; value: string; valueLabel: string };

/** One removable chip per applied filter, in the toolbar's order, named "<filter>: <option>". */
export function filterChips(filters: readonly FilterConfig[], applied: (filter: FilterConfig) => string): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const filter of filters) {
    const value = applied(filter);
    if (value === "") continue;
    const option = filter.options.find((entry) => entry.value === value);
    if (!option) continue;
    chips.push({ param: filter.param, label: filter.label, value, valueLabel: option.label });
  }
  return chips;
}

/** Removing one chip: that filter's key only, back to page 1. */
export function removeFilterQuery(query: string | URLSearchParams, param: string, pageParam = "page"): string {
  return applyListChange(query, { [param]: null }, pageParam);
}
