"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { ChevronDown, Heart, LayoutGrid, Rows3, Search, X } from "lucide-react";
import { useT } from "@/lib/3d/viewer/i18n";
import { useClickOutside } from "@/components/3d/viewer/hooks/useClickOutside";
import { cn } from "@/lib/3d/viewer/utils";
import type { Currency, Unit } from "@/lib/3d/viewer/types";
import type { AreaUnit } from "@/components/3d/viewer/hooks/useViewerPreferences";
import { areaFromDisplay, areaToDisplay, formatUnitArea, unitPriceLabel } from "./unitDisplay";
import {
  activeFilterCount,
  unitFacets,
  bedroomLabel,
  DEFAULT_UNIT_FILTERS,
  filterUnits,
  hasPricedUnits,
  sortOptionsFor,
  sortUnits,
  STATUS_DOT,
  type SortOption,
  type StatusFilter,
  type UnitFilterState,
} from "./unitFilters";
import { FormSelect } from "@/components/ui/form-select";

const STATUS_PILL_ORDER: { id: Exclude<StatusFilter, "all">; dotClass?: string }[] = [
  { id: "available" },
  { id: "reserved", dotClass: STATUS_DOT.reserved },
  { id: "sold", dotClass: STATUS_DOT.sold },
];
export const UNITS_PAGE_SIZE = 30;

function FilterDropdown({ label, active, children }: { label: string; active: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-8 items-center gap-1 rounded-control border px-2.5 text-xs font-medium transition-colors",
          active ? "border-accent/60 bg-accent/15 text-accent-fg" : "border-fg/10 bg-fg/5 text-fg/70 hover:text-fg"
        )}
      >
        {label}
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </button>
      {open && (
        <div role="dialog" className="viewer-glass absolute left-0 top-[calc(100%+6px)] z-20 w-56 rounded-panel p-3">
          {children}
        </div>
      )}
    </div>
  );
}

function NumberField({ placeholder, value, onChange }: { placeholder: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="h-8 w-full rounded-control border border-fg/15 bg-fg/5 px-2 text-xs text-fg placeholder:text-fg/30"
    />
  );
}

export function UnitSearchView({
  units,
  selectedUnitId,
  unmappedUnitId,
  favorites,
  onToggleFavorite,
  onSelectUnit,
  filters,
  onFiltersChange,
  viewMode,
  onViewModeChange,
  visibleCount,
  onVisibleCountChange,
  displayCurrency,
  eurToAllRate,
  areaUnit,
}: {
  units: Unit[];
  selectedUnitId: string | null;
  unmappedUnitId: string | null;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  onSelectUnit: (unit: Unit) => void;
  filters: UnitFilterState;
  onFiltersChange: Dispatch<SetStateAction<UnitFilterState>>;
  viewMode: "list" | "grid";
  onViewModeChange: Dispatch<SetStateAction<"list" | "grid">>;
  visibleCount: number;
  onVisibleCountChange: Dispatch<SetStateAction<number>>;
  displayCurrency: Currency;
  eurToAllRate: number;
  areaUnit: AreaUnit;
}) {
  const { t } = useT();

  const filtered = useMemo(() => sortUnits(filterUnits(units, filters), filters.sort), [units, filters]);
  const selectedIndex = selectedUnitId ? filtered.findIndex((u) => u.id === selectedUnitId) : -1;
  const effectiveVisibleCount =
    selectedIndex >= visibleCount ? Math.ceil((selectedIndex + 1) / UNITS_PAGE_SIZE) * UNITS_PAGE_SIZE : visibleCount;
  const visible = filtered.slice(0, effectiveVisibleCount);
  const selectedRowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!selectedUnitId) return;
    selectedRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedUnitId]);
  const filterCount = activeFilterCount(filters);
  const facets = useMemo(() => unitFacets(units, filters), [units, filters]);
  const statusPills = useMemo<{ id: StatusFilter; dotClass?: string }[]>(
    () =>
      facets.statuses.length === 0
        ? []
        : [...STATUS_PILL_ORDER.filter((p) => facets.statuses.includes(p.id)), { id: "all" as const }],
    [facets.statuses]
  );

  function update(patch: Partial<UnitFilterState>) {
    onFiltersChange((prev) => ({ ...prev, ...patch }));
    onVisibleCountChange(UNITS_PAGE_SIZE);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2.5 border-b border-fg/10 px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/40" aria-hidden="true" />
          <input
            type="text"
            value={filters.query}
            onChange={(e) => update({ query: e.target.value })}
            placeholder={t("units.searchPlaceholder")}
            className="h-9 w-full rounded-control border border-fg/10 bg-fg/5 pl-8 pr-2 text-sm text-fg placeholder:text-fg/35"
          />
        </div>

        {statusPills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {statusPills.map(({ id, dotClass }) => (
            <button
              key={id}
              type="button"
              onClick={() => update({ status: id })}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-pill px-2.5 text-xs font-medium transition-colors",
                filters.status === id ? "bg-accent text-accent-fg" : "bg-fg/5 text-fg/70 hover:bg-fg/10 hover:text-fg"
              )}
            >
              {dotClass && <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} aria-hidden="true" />}
              {t(`units.status.${id}`)}
            </button>
          ))}
        </div>
        )}

        {facets.bedrooms.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {facets.bedrooms.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => update({ bedrooms: filters.bedrooms === b ? null : b })}
              className={cn(
                "flex h-7 items-center rounded-pill px-2.5 text-xs font-medium transition-colors",
                filters.bedrooms === b ? "bg-accent text-accent-fg" : "bg-fg/5 text-fg/70 hover:bg-fg/10 hover:text-fg"
              )}
            >
              {bedroomLabel(b)}
            </button>
          ))}
        </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {hasPricedUnits(units) && (
            <FilterDropdown label={t("units.filterPrice")} active={filters.minPrice != null || filters.maxPrice != null}>
              <div className="flex items-center gap-2">
                <NumberField placeholder={t("units.min")} value={filters.minPrice} onChange={(v) => update({ minPrice: v })} />
                <NumberField placeholder={t("units.max")} value={filters.maxPrice} onChange={(v) => update({ maxPrice: v })} />
              </div>
            </FilterDropdown>
          )}
          <FilterDropdown label={t("units.filterFloor")} active={filters.minFloor != null || filters.maxFloor != null}>
            <div className="flex items-center gap-2">
              <NumberField placeholder={t("units.min")} value={filters.minFloor} onChange={(v) => update({ minFloor: v })} />
              <NumberField placeholder={t("units.max")} value={filters.maxFloor} onChange={(v) => update({ maxFloor: v })} />
            </div>
          </FilterDropdown>
          <FilterDropdown label={t("units.filterSurface")} active={filters.minArea != null || filters.maxArea != null}>
            <div className="flex items-center gap-2">
              <NumberField
                placeholder={t("units.min")}
                value={filters.minArea == null ? null : areaToDisplay(filters.minArea, areaUnit)}
                onChange={(v) => update({ minArea: v == null ? null : areaFromDisplay(v, areaUnit) })}
              />
              <NumberField
                placeholder={t("units.max")}
                value={filters.maxArea == null ? null : areaToDisplay(filters.maxArea, areaUnit)}
                onChange={(v) => update({ maxArea: v == null ? null : areaFromDisplay(v, areaUnit) })}
              />
            </div>
          </FilterDropdown>
          {facets.buildings.length > 0 && (
          <FilterDropdown label={t("units.filterBuilding")} active={filters.building != null}>
            <div className="space-y-0.5">
              {facets.buildings.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => update({ building: filters.building === b ? null : b })}
                  className={cn(
                    "flex w-full items-center justify-between rounded-control px-2 py-1.5 text-left text-xs",
                    filters.building === b ? "bg-accent/20 text-accent-fg" : "text-fg/70 hover:bg-fg/10 hover:text-fg"
                  )}
                >
                  {b}
                </button>
              ))}
            </div>
          </FilterDropdown>
          )}
        </div>

        <div className="flex items-center justify-between pt-0.5 text-xs">
          <span className="cursor-default text-fg/30" title={t("units.moreComingSoon")}>
            {t("units.advancedFilters")}
          </span>
          {filterCount > 0 && (
            <button
              type="button"
              onClick={() => onFiltersChange(DEFAULT_UNIT_FILTERS)}
              className="flex items-center gap-1 font-medium text-accent-strong hover:text-accent-strong"
            >
              {t("units.clearFilters")} <span className="tabular-nums">({filterCount})</span>
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between border-b border-fg/10 px-4 py-2">
        <span className="text-xs text-fg/50">{t("units.resultsCount", { count: filtered.length })}</span>
        <div className="flex items-center gap-2">
          <FormSelect
            value={filters.sort}
            onChange={(e) => update({ sort: e.target.value as SortOption })}
            className="h-7 rounded-control border border-fg/10 bg-fg/5 px-1.5 text-xs text-fg/70"
          >
            {sortOptionsFor(units).map((opt) => (
              <option key={opt} value={opt} className="bg-surface">
                {t(`units.sort.${opt}`)}
              </option>
            ))}
          </FormSelect>
          <button
            type="button"
            onClick={() => onViewModeChange((m) => (m === "list" ? "grid" : "list"))}
            aria-label={t(viewMode === "list" ? "units.viewGrid" : "units.viewList")}
            title={t(viewMode === "list" ? "units.viewGrid" : "units.viewList")}
            className="flex h-7 w-7 items-center justify-center rounded-control text-fg/60 hover:bg-fg/10 hover:text-fg"
          >
            {viewMode === "list" ? <LayoutGrid className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {visible.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-fg/40">{t("units.noResults")}</p>
        ) : (
          <div className={viewMode === "grid" ? "grid grid-cols-2 gap-2" : "space-y-1.5"}>
            {visible.map((unit) => {
              const isSelected = unit.id === selectedUnitId;
              return (
              <button
                key={unit.id}
                ref={isSelected ? selectedRowRef : undefined}
                type="button"
                onClick={() => onSelectUnit(unit)}
                aria-current={isSelected ? "true" : undefined}
                className={cn(
                  "w-full rounded-control border p-2.5 text-left transition-colors",
                  isSelected
                    ? "border-accent/60 bg-accent/15"
                    : "border-fg/5 bg-fg/[0.03] hover:border-fg/15 hover:bg-fg/[0.06]"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-fg">{unit.code}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="text-sm font-semibold text-fg">
                      {unitPriceLabel(unit, displayCurrency, eurToAllRate, t("projectDetail.priceOnRequest"))}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(unit.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          onToggleFavorite(unit.id);
                        }
                      }}
                      aria-label={t("units.favorite")}
                      aria-pressed={favorites.has(unit.id)}
                      className="text-fg/40 hover:text-fg"
                    >
                      <Heart className={cn("h-3.5 w-3.5", favorites.has(unit.id) && "fill-accent text-accent-strong")} />
                    </span>
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-fg/50">
                  <span>
                    {t("units.floorLabel", { floor: unit.floor })} · {bedroomLabel(unit.bedrooms)} · {formatUnitArea(unit.area, areaUnit)}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[unit.status])} aria-hidden="true" />
                    {t(`units.status.${unit.status}`)}
                  </span>
                </div>
                {unmappedUnitId === unit.id && (
                  <p className="mt-1.5 text-[11px] leading-tight text-warning-strong/80">{t("units.notInModel")}</p>
                )}
              </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-fg/10 px-4 py-2.5 text-xs text-fg/50">
        <span>{t("units.showingRange", { shown: visible.length, total: filtered.length })}</span>
        {visibleCount < filtered.length && (
          <button
            type="button"
            onClick={() => onVisibleCountChange((c) => c + UNITS_PAGE_SIZE)}
            className="font-medium text-accent-strong hover:text-accent-strong"
          >
            {t("units.loadMore")}
          </button>
        )}
      </div>
    </div>
  );
}
