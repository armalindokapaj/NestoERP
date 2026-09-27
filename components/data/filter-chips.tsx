"use client";

import { X } from "lucide-react";

import type { FilterChip } from "@/lib/tables/filter-draft";
import { cn } from "@/lib/utils/cn";
import { useTranslations } from "@/components/i18n/i18n-provider";

/**
 * The applied filters as removable chips, outside the filter sheet
 * (AUD-04 §5, MW-06), after the approvals chips (`approval-filters.tsx`).
 *
 * Each chip removes its one filter at once; Clear all resets every filter and
 * the search at once. The pill stays compact, but each control's hit area is
 * 44px tall (`min-h-11`), since the chips are shown only on phone layouts.
 */
export function FilterChips({
  chips,
  onRemove,
  onClearAll,
  className,
}: {
  chips: FilterChip[];
  onRemove: (param: string) => void;
  /** Present when anything (a filter, the search, another list key) can be cleared. */
  onClearAll?: () => void;
  className?: string;
}) {
  const t = useTranslations("ui");
  if (chips.length === 0 && !onClearAll) return null;
  return (
    <div role="group" aria-label={t("activeFilters")} className={cn("flex flex-wrap items-center gap-x-1.5", className)} data-filter-chips>
      {chips.map((chip) => (
        <button
          key={chip.param}
          type="button"
          onClick={() => onRemove(chip.param)}
          aria-label={t("removeFilter", { label: chip.label, value: chip.valueLabel })}
          className="group inline-flex min-h-11 min-w-11 max-w-full items-center focus-visible:outline-none"
        >
          <span className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border border-line bg-surface py-1 pl-3 pr-2 text-meta font-medium text-fg transition-colors group-hover:border-line-strong group-focus-visible:ring-2 group-focus-visible:ring-ring/40">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="text-fg-subtle">{chip.label}:</span> {chip.valueLabel}
            </span>
            <X aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
          </span>
        </button>
      ))}
      {onClearAll ? (
        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex min-h-11 items-center px-2 text-meta font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {t("clearAll")}
        </button>
      ) : null}
    </div>
  );
}
