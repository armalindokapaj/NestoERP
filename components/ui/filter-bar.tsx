"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";

import { SearchField } from "@/components/ui/search-field";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils/cn";

/**
 * FilterBar (design spec §61, §62, §89).
 *
 * Desktop renders an inline toolbar; below the tablet breakpoint the filters
 * move into a drawer behind a single Filters button, so a narrow screen is
 * never buried under controls.
 *
 * Filtering is not implemented in V0.1 — pass `disabled` and the controls
 * present themselves as not-yet-available rather than doing nothing silently.
 */
export type FilterDefinition = { label: string; options: string[] };

function FilterSelect({
  filter,
  disabled,
  className,
}: {
  filter: FilterDefinition;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      disabled={disabled}
      aria-label={filter.label}
      defaultValue=""
      className={cn(
        "h-10 rounded-md border border-line bg-surface px-3 text-table font-medium text-fg-muted transition-colors",
        "hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20",
        "disabled:cursor-not-allowed disabled:bg-surface-muted",
        className,
      )}
    >
      <option value="">{filter.label}</option>
      {filter.options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

export function FilterBar({
  searchPlaceholder = "Search…",
  filters = [],
  disabled = false,
  className,
}: {
  searchPlaceholder?: string;
  filters?: FilterDefinition[];
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <SearchField
        placeholder={searchPlaceholder}
        disabled={disabled}
        aria-label={searchPlaceholder}
        title={disabled ? "Filtering arrives in a later version" : undefined}
        className="max-w-xs"
      />

      {/* Tablet and up: the filters sit inline (§62). */}
      <div className="hidden items-center gap-2 md:flex">
        {filters.map((filter) => (
          <FilterSelect key={filter.label} filter={filter} disabled={disabled} />
        ))}
      </div>

      {/* Mobile: one button, filters in a drawer (§62). */}
      {filters.length > 0 ? (
        <Drawer open={open} onOpenChange={setOpen}>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-line bg-surface px-3 text-table font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg md:hidden"
          >
            <SlidersHorizontal aria-hidden="true" className="size-4" />
            Filters
          </button>

          <DrawerContent side="bottom">
            <DrawerTitle className="border-b border-line px-4 py-3 text-card font-semibold text-fg">
              Filters
            </DrawerTitle>
            <div className="flex flex-col gap-3 p-4">
              {filters.map((filter) => (
                <label key={filter.label} className="flex flex-col gap-1.5">
                  <span className="text-table font-medium text-fg">{filter.label}</span>
                  <FilterSelect filter={filter} disabled={disabled} className="w-full" />
                </label>
              ))}
            </div>
          </DrawerContent>
        </Drawer>
      ) : null}
    </div>
  );
}
