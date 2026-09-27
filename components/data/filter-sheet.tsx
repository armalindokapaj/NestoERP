"use client";

import * as React from "react";
import { SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import {
  clearedDraft,
  draftCount,
  draftFromApplied,
  setDraftValue,
  type FilterConfig,
  type FilterDraft,
} from "@/lib/tables/filter-draft";
import { cn } from "@/lib/utils/cn";
import { useTranslations } from "@/components/i18n/i18n-provider";

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
}: {
  filters: readonly FilterConfig[];
  /** The applied value of a filter, "" for All. */
  applied: (filter: FilterConfig) => string;
  /** Applied filters, including list keys set outside the sheet (a date range). */
  activeCount: number;
  onApply: (draft: FilterDraft) => void;
  title?: string;
}) {
  const t = useTranslations("ui");
  const title = titleProp ?? t("filters");
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<FilterDraft>({});
  const id = React.useId();

  function openSheet() {
    setDraft(draftFromApplied(filters, applied));
    setOpen(true);
  }

  const staged = draftCount(filters, draft);

  return (
    <Drawer open={open} onOpenChange={(next) => (next ? openSheet() : setOpen(false))}>
      {/* A Radix trigger: the sheet returns focus to it when it closes. */}
      <DrawerTrigger asChild>
      <button
        type="button"
        data-filter-sheet-trigger
        className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-line bg-surface px-3 text-table font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg md:hidden"
      >
        <SlidersHorizontal aria-hidden="true" className="size-4" />
        {t("filters")}
        {activeCount > 0 ? (
          <>
            <span aria-hidden="true" className="rounded-full bg-accent px-1.5 text-micro text-accent-fg tabular-nums">
              {activeCount}
            </span>
            <span className="sr-only">{t("filtersApplied", { count: activeCount })}</span>
          </>
        ) : null}
      </button>
      </DrawerTrigger>

      <DrawerContent side="bottom" data-testid="filter-sheet" aria-describedby={`${id}-description`}>
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
            {filters.map((filter) => (
              <div key={filter.param} className="flex flex-col gap-1.5">
                {/* An explicit label rather than a wrapping one: a select
                    inside a <label> takes its option text into its accessible
                    name, which turns "Status" into "StatusAllDraftActive…". */}
                <label htmlFor={`${id}-${filter.param}`} className="text-table font-medium text-fg">
                  {filter.label}
                </label>
                <select
                  id={`${id}-${filter.param}`}
                  className={cn(
                    "h-11 w-full rounded-md border border-line bg-surface px-3 text-base font-medium text-fg-muted",
                    "transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20",
                  )}
                  value={draft[filter.param] ?? ""}
                  onChange={(event) => setDraft((current) => setDraftValue(current, filter, event.target.value))}
                >
                  <option value="">{t("all")}</option>
                  {filter.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
            <Button type="button" variant="ghost" onClick={() => setDraft(clearedDraft(filters))} disabled={staged === 0}>
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
