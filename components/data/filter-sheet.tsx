"use client";

import * as React from "react";
import { Plus, SlidersHorizontal, X } from "@/components/icons";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import {
  clearedDraft,
  draftCount,
  draftFromApplied,
  moreFilterCount,
  moreFilterParams,
  setDraftValue,
  type FilterConfig,
  type FilterDraft,
  type MoreFilterField,
} from "@/lib/tables/filter-draft";
import { cn } from "@/lib/utils/cn";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { FormSelect } from "@/components/ui/form-select";

/**
 * The phone filter sheet (AUD-04 §5, MW-06): a staged form, after the
 * approvals filter drawer (`components/approvals/approval-filters.tsx`).
 *
 * - The Filters button names how many filters are applied, as a badge and in
 *   its accessible name.
 * - The sheet opens with the applied values. Changing a field changes only the
 *   draft; Apply sends the whole draft as one navigation (page 1).
 * - Cancel, the close button, Escape and the backdrop all drop the draft: the
 *   applied values stand and the list is not asked again.
 * - Clear empties the fields, still only until Apply.
 *
 * The open state and the draft live here, not in a width-dependent tree, so
 * turning the phone (or crossing `md` with the sheet open) keeps both (MW-16).
 * The sheet holds no unsaved record input, so closing it never asks (AUD-03).
 */
export function FilterSheet({
  filters,
  applied,
  activeCount,
  onApply,
  title: titleProp,
  more = [],
  current = () => "",
  variant = "filters",
}: {
  filters: readonly FilterConfig[];
  /** The applied value of a filter, "" for All. */
  applied: (filter: FilterConfig) => string;
  /** Applied filters, including list keys set outside the sheet (a date range). */
  activeCount: number;
  onApply: (draft: FilterDraft) => void;
  title?: string;
  /** The filters behind "More filters" (UI-07): the sheet opens to the whole screen to show them. */
  more?: readonly MoreFilterField[];
  /** A More filter's applied value, from the URL. */
  current?: (param: string) => string;
  /**
   * `filters`: the phone's Filters button and sheet — the few filters, then
   * More filters. `more`: from md, the More filters button beside the inline
   * filters, opening a panel of the More filters alone.
   */
  variant?: "filters" | "more";
}) {
  const t = useTranslations("ui");
  const title = titleProp ?? (variant === "more" ? t("moreFilters") : t("filters"));
  const [open, setOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [draft, setDraft] = React.useState<FilterDraft>({});
  const id = React.useId();
  const moreParams = moreFilterParams(more);
  const defaults = variant === "more" ? [] : filters;

  function openSheet() {
    const staged = draftFromApplied(defaults, applied);
    for (const param of moreParams) staged[param] = current(param);
    setDraft(staged);
    // Open on the More filters when some are already set, so what narrows the list is in view.
    setExpanded(variant === "more" || moreFilterCount(more, current) > 0);
    setOpen(true);
  }

  function clear() {
    const cleared = clearedDraft(defaults);
    for (const param of moreParams) cleared[param] = "";
    setDraft(cleared);
  }

  const moreSet = moreFilterCount(more, (param) => draft[param] ?? "");
  const staged = draftCount(defaults, draft) + moreSet;
  const appliedMore = moreFilterCount(more, current);

  const selectClass = cn(
    "h-11 w-full rounded-md border border-line bg-surface px-3 text-base font-medium text-fg-muted",
    "transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20",
  );
  const fieldLabel = "text-table font-medium text-fg";

  return (
    <Drawer open={open} onOpenChange={(next) => (next ? openSheet() : setOpen(false))}>
      {/* A Radix trigger: the sheet returns focus to it when it closes. */}
      <DrawerTrigger asChild>
        {variant === "more" ? (
          <button
            type="button"
            data-more-filters-trigger
            className="inline-flex h-(--nesto-height-control) shrink-0 items-center gap-2 border border-line bg-surface px-3 text-table font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            <SlidersHorizontal aria-hidden="true" className="size-4" />
            {t("moreFilters")}
            {appliedMore > 0 ? (
              <>
                <span aria-hidden="true" className="bg-accent px-1.5 text-micro text-accent-fg tabular-nums">
                  {appliedMore}
                </span>
                <span className="sr-only">{t("filtersApplied", { count: appliedMore })}</span>
              </>
            ) : null}
          </button>
        ) : (
          <button
            type="button"
            data-filter-sheet-trigger
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-line bg-surface px-3 text-table font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg md:hidden"
          >
            <SlidersHorizontal aria-hidden="true" className="size-4" />
            {t("filters")}
            {activeCount > 0 ? (
              <>
                <span aria-hidden="true" className="bg-accent px-1.5 text-micro text-accent-fg tabular-nums">
                  {activeCount}
                </span>
                <span className="sr-only">{t("filtersApplied", { count: activeCount })}</span>
              </>
            ) : null}
          </button>
        )}
      </DrawerTrigger>

      <DrawerContent
        side={variant === "more" ? "right" : "bottom"}
        data-testid={variant === "more" ? "more-filters-panel" : "filter-sheet"}
        data-expanded={expanded || undefined}
        aria-describedby={`${id}-description`}
        // More filters open the phone's sheet to the whole screen.
        className={cn(variant === "filters" && expanded && "top-0 h-dvh max-h-dvh pt-[env(safe-area-inset-top)]")}
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            onApply(draft);
            setOpen(false);
          }}
        >
          <div className="flex items-start justify-between gap-2 border-b border-line py-2 pl-4 pr-1">
            <div className="min-w-0 py-1">
              <DrawerTitle className="text-card font-semibold text-fg">{title}</DrawerTitle>
              <DrawerDescription id={`${id}-description`} className="text-meta text-fg-muted">
                {t("filtersHint")}
              </DrawerDescription>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label={t("closeFilters")} onClick={() => setOpen(false)}>
              <X aria-hidden="true" />
            </Button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {defaults.map((filter) => (
              <div key={filter.param} className="flex flex-col gap-1.5">
                {/* An explicit label rather than a wrapping one: a select
                    inside a <label> takes its option text into its accessible
                    name, which turns "Status" into "StatusAllDraftActive…". */}
                <label htmlFor={`${id}-${filter.param}`} className={fieldLabel}>
                  {filter.label}
                </label>
                <FormSelect
                  id={`${id}-${filter.param}`}
                  className={selectClass}
                  value={draft[filter.param] ?? ""}
                  onChange={(event) => setDraft((current) => setDraftValue(current, filter, event.target.value))}
                >
                  <option value="">{t("all")}</option>
                  {filter.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </FormSelect>
              </div>
            ))}

            {more.length > 0 && variant === "filters" && !expanded ? (
              <button
                type="button"
                data-more-filters
                onClick={() => setExpanded(true)}
                className="flex min-h-12 w-full items-center justify-between gap-3 border border-dashed border-line-strong px-4 text-left text-table font-medium text-fg transition-colors hover:bg-hover"
              >
                <span className="flex items-center gap-2">
                  <Plus aria-hidden="true" className="size-4 text-fg-subtle" />
                  {t("moreFilters")}
                </span>
                {moreSet > 0 ? <span className="font-mono text-meta tabular-nums text-fg-subtle">{moreSet}</span> : null}
              </button>
            ) : null}

            {more.length > 0 && expanded ? (
              <section aria-label={t("moreFilters")} className={cn("space-y-3", variant === "filters" && "border-t border-line pt-4")}>
                {variant === "filters" ? <p aria-hidden="true" className="nesto-eyebrow text-fg-subtle">{t("moreFilters")}</p> : null}
                {more.map((field) =>
                  field.kind === "range" ? (
                    <fieldset key={field.minParam} className="flex flex-col gap-1.5">
                      <legend className={cn(fieldLabel, "mb-1.5")}>
                        {field.label}
                        {field.unit ? <span className="ml-1.5 font-normal text-fg-subtle">({field.unit})</span> : null}
                      </legend>
                      <div className="grid grid-cols-2 gap-2">
                        {(
                          [
                            [field.minParam, t("rangeFrom")],
                            [field.maxParam, t("rangeTo")],
                          ] as const
                        ).map(([param, label]) => (
                          <label key={param} className="flex h-11 items-center gap-2 border border-line bg-surface px-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-ring/20">
                            <span className="shrink-0 font-mono text-micro uppercase tracking-[0.08em] text-fg-subtle">{label}</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="any"
                              name={param}
                              aria-label={`${field.label}, ${label}`}
                              value={draft[param] ?? ""}
                              onChange={(event) => setDraft((current) => ({ ...current, [param]: event.target.value }))}
                              className="h-full min-w-0 flex-1 bg-transparent text-base tabular-nums text-fg outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : (
                    <div key={field.param} className="flex flex-col gap-1.5">
                      <label htmlFor={`${id}-${field.param}`} className={fieldLabel}>
                        {field.label}
                      </label>
                      <FormSelect
                        id={`${id}-${field.param}`}
                        className={selectClass}
                        value={draft[field.param] ?? ""}
                        onChange={(event) => setDraft((current) => ({ ...current, [field.param]: event.target.value }))}
                      >
                        <option value="">{t("all")}</option>
                        {field.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </FormSelect>
                    </div>
                  ),
                )}
              </section>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
            <Button type="button" variant="ghost" onClick={clear} disabled={staged === 0}>
              {t("clear")}
            </Button>
            <Button type="button" variant="secondary" className="ml-auto" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit">
              {t("apply")}
            </Button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
