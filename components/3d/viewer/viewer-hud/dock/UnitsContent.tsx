"use client";

import { forwardRef, Fragment, useEffect, useMemo, useRef, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import { gsap } from "gsap";
import { Building2, Check, ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { useT } from "@/lib/3d/viewer/i18n";
import { useEffectiveReducedMotion } from "@/components/3d/viewer/hooks/useEffectiveReducedMotion";
import { useViewerPreferences } from "@/components/3d/viewer/hooks/useViewerPreferences";
import { clamp, cn } from "@/lib/3d/viewer/utils";
import { formatUnitArea } from "../../units-workspace/unitDisplay";
import {
  activeFilterCount,
  unitFacets,
  bedroomLabel,
  filterUnits,
  STATUS_DOT,
  type StatusFilter,
  type UnitFilterState,
} from "../../units-workspace/unitFilters";
import type { Unit } from "@/lib/3d/viewer/types";
import { DOCK_MORPH_EASE, DOCK_MORPH_TIMING } from "../layoutState";
import { DockPopover } from "./DockPopover";
import type { DockPopoverId } from "./DockContent";

const AVAILABILITY_PILL_ORDER: Exclude<StatusFilter, "all">[] = ["available", "reserved", "sold"];

export const UnitsContent = forwardRef<
  HTMLDivElement,
  {
    isDesktop: boolean;
    units: Unit[];
    filters: UnitFilterState;
    onFiltersChange: Dispatch<SetStateAction<UnitFilterState>>;
    listOpen: boolean;
    onToggleList: () => void;
    onBack: () => void;
    onClose: () => void;
    filtersExpanded: boolean;
    onToggleFilters: () => void;
    openPopover: DockPopoverId | null;
    onTogglePopover: (id: DockPopoverId) => void;
    onClosePopover: () => void;
  }
>(function UnitsContent(
  {
    isDesktop,
    units,
    filters,
    onFiltersChange,
    listOpen,
    onToggleList,
    onClose,
    filtersExpanded,
    onToggleFilters,
    openPopover,
    onTogglePopover,
    onClosePopover,
  },
  ref
) {
  const { t } = useT();
  const { areaUnit } = useViewerPreferences();
  const reducedMotion = useEffectiveReducedMotion();

  const filteredCount = useMemo(() => filterUnits(units, filters).length, [units, filters]);

  const areaBounds = useMemo(() => {
    if (units.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const u of units) {
      if (u.area < min) min = u.area;
      if (u.area > max) max = u.area;
    }
    return min < max ? { min: Math.floor(min), max: Math.ceil(max) } : null;
  }, [units]);

  const facets = useMemo(() => unitFacets(units, filters), [units, filters]);
  const availabilityPills = useMemo<StatusFilter[]>(
    () => (facets.statuses.length === 0 ? [] : ["all", ...AVAILABILITY_PILL_ORDER.filter((id) => facets.statuses.includes(id))]),
    [facets.statuses]
  );
  const hasBedrooms = facets.bedrooms.length > 0;
  const hasBathrooms = facets.bathrooms.length > 0;
  const hasRooms = hasBedrooms || hasBathrooms;
  const hasSurface = areaBounds != null;
  const hasAvailability = availabilityPills.length > 0;
  const hasAnyFilter = hasSurface || hasRooms || hasAvailability;

  const surfaceTriggerRef = useRef<HTMLButtonElement>(null);
  const roomsTriggerRef = useRef<HTMLButtonElement>(null);
  const roomsTriggerMobileRef = useRef<HTMLButtonElement>(null);

  const hiddenFilterCount = activeFilterCount(filters) + (filters.status !== "all" ? 1 : 0);

  const collapsibleRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const prevExpandedRef = useRef(filtersExpanded);
  useEffect(() => {
    const el = collapsibleRef.current;
    if (!el) {
      mountedRef.current = false;
      return;
    }
    if (!mountedRef.current) {
      mountedRef.current = true;
      prevExpandedRef.current = filtersExpanded;
      if (!filtersExpanded) gsap.set(el, { height: 0, overflow: "hidden", autoAlpha: 0 });
      return;
    }
    if (prevExpandedRef.current === filtersExpanded) return;
    prevExpandedRef.current = filtersExpanded;

    gsap.killTweensOf(el);
    const duration = reducedMotion ? 0.001 : DOCK_MORPH_TIMING.containerMorph;
    if (filtersExpanded) {
      gsap.set(el, { overflow: "hidden" });
      const target = el.scrollHeight;
      gsap.fromTo(
        el,
        { height: 0, autoAlpha: 0 },
        {
          height: target,
          autoAlpha: 1,
          duration,
          ease: DOCK_MORPH_EASE,
          onComplete: () => gsap.set(el, { clearProps: "height,overflow,visibility,opacity" }),
        }
      );
    } else {
      gsap.set(el, { overflow: "hidden", height: el.getBoundingClientRect().height });
      gsap.to(el, { height: 0, autoAlpha: 0, duration, ease: DOCK_MORPH_EASE });
    }
  }, [filtersExpanded, reducedMotion, isDesktop]);

  const effMin = areaBounds ? clamp(filters.minArea ?? areaBounds.min, areaBounds.min, areaBounds.max) : 0;
  const effMax = areaBounds ? clamp(filters.maxArea ?? areaBounds.max, areaBounds.min, areaBounds.max) : 0;
  const areaGap = areaBounds ? Math.max(1, Math.round((areaBounds.max - areaBounds.min) * 0.02)) : 1;

  function handleMinAreaChange(e: ChangeEvent<HTMLInputElement>) {
    if (!areaBounds) return;
    const raw = clamp(Number(e.target.value), areaBounds.min, effMax - areaGap);
    onFiltersChange((prev) => ({ ...prev, minArea: raw <= areaBounds.min ? null : raw }));
  }
  function handleMaxAreaChange(e: ChangeEvent<HTMLInputElement>) {
    if (!areaBounds) return;
    const raw = clamp(Number(e.target.value), effMin + areaGap, areaBounds.max);
    onFiltersChange((prev) => ({ ...prev, maxArea: raw >= areaBounds.max ? null : raw }));
  }

  const fillLeftPct = areaBounds ? ((effMin - areaBounds.min) / (areaBounds.max - areaBounds.min)) * 100 : 0;
  const fillRightPct = areaBounds ? 100 - ((effMax - areaBounds.min) / (areaBounds.max - areaBounds.min)) * 100 : 0;
  const minThumbOnTop = areaBounds ? (effMin - areaBounds.min) / (areaBounds.max - areaBounds.min) > 0.5 : false;

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      aria-label={t("common.close")}
      title={t("common.close")}
      className="flex shrink-0 items-center rounded-control px-1.5 text-accent-strong transition-colors hover:text-accent-strong"
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  const listTrigger = (
    <button
      type="button"
      onClick={onToggleList}
      aria-pressed={listOpen}
      aria-label={`${t("units.listUnits")} — ${t("units.foundCount", { count: filteredCount })}`}
      title={t("units.listUnits")}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-control px-1.5 text-sm font-medium transition-colors",
        listOpen ? "text-accent-strong" : "text-fg hover:text-accent-strong"
      )}
    >
      <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
      {t("units.filterListLabel")}
      <span className="rounded-full bg-fg/10 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-fg/70" aria-hidden="true">
        {filteredCount}
      </span>
    </button>
  );

  const surfaceSlider = areaBounds ? (
    <div className="relative flex h-5 items-center">
      <div className="pointer-events-none absolute inset-x-0 h-1.5 rounded-full bg-fg/10" />
      <div
        className="pointer-events-none absolute h-1.5 rounded-full bg-accent"
        style={{ left: `${fillLeftPct}%`, right: `${fillRightPct}%` }}
      />
      <input
        type="range"
        min={areaBounds.min}
        max={areaBounds.max}
        value={effMin}
        onChange={handleMinAreaChange}
        aria-label={t("units.rangeMinimum", { label: t("units.filterSurface") })}
        className="rz-range-thumb"
        style={{ zIndex: minThumbOnTop ? 5 : 3 }}
      />
      <input
        type="range"
        min={areaBounds.min}
        max={areaBounds.max}
        value={effMax}
        onChange={handleMaxAreaChange}
        aria-label={t("units.rangeMaximum", { label: t("units.filterSurface") })}
        className="rz-range-thumb"
        style={{ zIndex: minThumbOnTop ? 3 : 4 }}
      />
    </div>
  ) : (
    <div className="flex h-5 items-center" aria-hidden="true">
      <div className="h-1.5 w-full rounded-full bg-fg/10" />
    </div>
  );

  const surfaceLabel = areaBounds ? `${formatUnitArea(effMin, areaUnit)} – ${formatUnitArea(effMax, areaUnit)}` : t("common.any");
  const surfaceTrigger = (
    <div className="relative flex shrink-0 items-center">
      <button
        ref={surfaceTriggerRef}
        type="button"
        onClick={() => onTogglePopover("unitsSurface")}
        aria-haspopup="dialog"
        aria-expanded={openPopover === "unitsSurface"}
        disabled={!areaBounds}
        className="flex items-center gap-1.5 rounded-control px-2 text-sm font-medium text-fg transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="text-fg/50">{t("units.filterSurface")}</span>
        {surfaceLabel}
        <ChevronDown
          className={cn("h-3.5 w-3.5 text-fg/50 transition-transform", openPopover === "unitsSurface" && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      <DockPopover
        open={openPopover === "unitsSurface"}
        onClose={onClosePopover}
        triggerRef={surfaceTriggerRef}
        anchorClassName="left-0 w-56"
      >
        {areaBounds && (
          <div className="flex flex-col gap-2 px-1.5 py-1">
            {surfaceSlider}
            <div className="flex items-center justify-between text-xs font-semibold tabular-nums text-fg">
              <span>{formatUnitArea(effMin, areaUnit)}</span>
              <span>{formatUnitArea(effMax, areaUnit)}</span>
            </div>
          </div>
        )}
      </DockPopover>
    </div>
  );

  function optionList(label: string, value: number | null, options: number[], formatOption: (v: number) => string, onChange: (v: number | null) => void) {
    return (
      <div className="flex min-w-[112px] flex-1 flex-col gap-0.5" role="menu" aria-label={label}>
        <span className="px-2.5 pt-1 text-[11px] uppercase tracking-wide text-fg/40">{label}</span>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={value == null}
          onClick={() => onChange(null)}
          className={cn(
            "flex items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-sm font-medium transition-colors",
            value == null ? "bg-accent/10 text-accent-strong" : "text-fg/75 hover:bg-fg/5 hover:text-fg"
          )}
        >
          <span className="flex-1">{t("common.any")}</span>
          {value == null && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        </button>
        {options.map((opt) => {
          const isActive = value === opt;
          return (
            <button
              key={opt}
              type="button"
              role="menuitemradio"
              aria-checked={isActive}
              onClick={() => onChange(opt)}
              className={cn(
                "flex items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-sm font-medium transition-colors",
                isActive ? "bg-accent/10 text-accent-strong" : "text-fg/75 hover:bg-fg/5 hover:text-fg"
              )}
            >
              <span className="flex-1">{formatOption(opt)}</span>
              {isActive && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    );
  }

  const roomsLabelParts: string[] = [];
  if (filters.bedrooms != null) roomsLabelParts.push(bedroomLabel(filters.bedrooms));
  if (filters.bathrooms != null) roomsLabelParts.push(`${filters.bathrooms} ${t("units.filterBathrooms").toLowerCase()}`);
  const roomsSummary = roomsLabelParts.length > 0 ? roomsLabelParts.join(" · ") : t("common.any");

  const bedroomsSummary = filters.bedrooms != null ? bedroomLabel(filters.bedrooms) : t("common.any");
  const bathroomsSummary = filters.bathrooms != null ? String(filters.bathrooms) : t("common.any");

  const roomsTrigger = (
    <div className="relative flex shrink-0 items-center">
      <button
        ref={roomsTriggerRef}
        type="button"
        onClick={() => onTogglePopover("unitsRooms")}
        aria-haspopup="menu"
        aria-expanded={openPopover === "unitsRooms"}
        className="flex items-center gap-1.5 rounded-control px-2 text-sm font-medium text-fg transition-colors"
      >
        <span className="text-fg/50">{t("units.filterRooms")}</span>
        {roomsSummary}
        <ChevronDown
          className={cn("h-3.5 w-3.5 text-fg/50 transition-transform", openPopover === "unitsRooms" && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      <DockPopover
        open={openPopover === "unitsRooms"}
        onClose={onClosePopover}
        triggerRef={roomsTriggerRef}
        anchorClassName="left-0 flex gap-1"
      >
        {hasBedrooms &&
          optionList(t("units.filterBedrooms"), filters.bedrooms, facets.bedrooms, bedroomLabel, (v) =>
            onFiltersChange((prev) => ({ ...prev, bedrooms: v }))
          )}
        {hasBedrooms && hasBathrooms && <span className="my-1 w-px shrink-0 bg-fg/10" aria-hidden="true" />}
        {hasBathrooms &&
          optionList(t("units.filterBathrooms"), filters.bathrooms, facets.bathrooms, (v) => String(v), (v) =>
            onFiltersChange((prev) => ({ ...prev, bathrooms: v }))
          )}
      </DockPopover>
    </div>
  );

  function renderAvailabilityPills(wrapperClassName: string) {
    return (
      <div className={wrapperClassName}>
        {availabilityPills.map((id) => {
          const isActive = filters.status === id;
          const dotClass = id === "all" ? null : STATUS_DOT[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => onFiltersChange((prev) => ({ ...prev, status: id }))}
              aria-pressed={isActive}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-control px-2.5 py-1.5 text-xs font-medium transition-colors",
                isActive ? "bg-accent text-accent-fg" : "border border-fg/15 text-fg/75 hover:border-fg/25 hover:text-fg"
              )}
            >
              {dotClass && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} aria-hidden="true" />}
              {t(`units.status.${id}`)}
            </button>
          );
        })}
      </div>
    );
  }

  const divider = <span className="h-6 w-px shrink-0 bg-fg/10" aria-hidden="true" />;

  const filtersToggleMobile = (
    <button
      type="button"
      onClick={onToggleFilters}
      aria-expanded={filtersExpanded}
      aria-controls="viewer-units-filters"
      aria-label={t("units.filtersToggle")}
      className={cn(
        "flex h-11 shrink-0 items-center gap-1.5 rounded-control border px-3 text-sm font-medium transition-colors",
        filtersExpanded ? "border-accent/50 bg-accent/10 text-accent-strong" : "border-fg/15 text-fg hover:border-fg/25"
      )}
    >
      <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
      {hiddenFilterCount > 0 && (
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none",
            filtersExpanded ? "bg-accent/20 text-accent-strong" : "bg-fg/10 text-fg/70"
          )}
          aria-hidden="true"
        >
          {hiddenFilterCount}
        </span>
      )}
      <ChevronDown
        className={cn("h-3.5 w-3.5 shrink-0 transition-transform", filtersExpanded && "rotate-180")}
        aria-hidden="true"
      />
    </button>
  );

  const listTriggerMobile = (
    <div className="flex h-11 w-full items-center gap-2">
      <button
        type="button"
        onClick={onToggleList}
        aria-pressed={listOpen}
        aria-label={`${t("units.listUnits")} — ${t("units.foundCount", { count: filteredCount })}`}
        className={cn(
          "flex h-11 min-w-0 flex-1 items-center gap-2 rounded-control border px-3 text-sm font-medium transition-colors",
          listOpen ? "border-accent/50 bg-accent/10 text-accent-strong" : "border-fg/15 text-fg hover:border-fg/25"
        )}
      >
        <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate text-left">{t("units.filterListLabel")}</span>
        <span className="shrink-0 rounded-full bg-fg/10 px-2 py-0.5 text-xs font-semibold text-fg/70">{filteredCount}</span>
      </button>
      {hasAnyFilter && filtersToggleMobile}
      {closeButton}
    </div>
  );

  const roomsTriggerMobile = (
    <div className="relative flex w-full items-center">
      <button
        ref={roomsTriggerMobileRef}
        type="button"
        onClick={() => onTogglePopover("unitsRooms")}
        aria-haspopup="menu"
        aria-expanded={openPopover === "unitsRooms"}
        className="flex h-11 w-full items-stretch rounded-control border border-fg/15 text-sm font-medium text-fg transition-colors hover:border-fg/25"
      >
        {hasBedrooms && (
          <span className="flex flex-1 flex-col items-start justify-center gap-0.5 px-3 text-left">
            <span className="text-[11px] uppercase tracking-wide text-fg/50">{t("units.filterBedrooms")}</span>
            <span className="text-xs font-semibold text-fg">{bedroomsSummary}</span>
          </span>
        )}
        {hasBedrooms && hasBathrooms && <span className="my-2 w-px shrink-0 bg-fg/15" aria-hidden="true" />}
        {hasBathrooms && (
          <span className="flex flex-1 flex-col items-start justify-center gap-0.5 px-3 text-left">
            <span className="text-[11px] uppercase tracking-wide text-fg/50">{t("units.filterBathrooms")}</span>
            <span className="text-xs font-semibold text-fg">{bathroomsSummary}</span>
          </span>
        )}
        <ChevronDown
          className={cn("mr-3 h-3.5 w-3.5 shrink-0 self-center text-fg/50 transition-transform", openPopover === "unitsRooms" && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      <DockPopover
        open={openPopover === "unitsRooms"}
        onClose={onClosePopover}
        triggerRef={roomsTriggerMobileRef}
        anchorClassName="inset-x-0 flex gap-1"
      >
        {hasBedrooms &&
          optionList(t("units.filterBedrooms"), filters.bedrooms, facets.bedrooms, bedroomLabel, (v) =>
            onFiltersChange((prev) => ({ ...prev, bedrooms: v }))
          )}
        {hasBedrooms && hasBathrooms && <span className="my-1 w-px shrink-0 bg-fg/10" aria-hidden="true" />}
        {hasBathrooms &&
          optionList(t("units.filterBathrooms"), filters.bathrooms, facets.bathrooms, (v) => String(v), (v) =>
            onFiltersChange((prev) => ({ ...prev, bathrooms: v }))
          )}
      </DockPopover>
    </div>
  );

  if (isDesktop) {
    const zones = [
      listTrigger,
      hasSurface ? surfaceTrigger : null,
      hasRooms ? roomsTrigger : null,
      hasAvailability ? renderAvailabilityPills("flex shrink-0 items-center gap-1.5") : null,
      closeButton,
    ].filter(Boolean);
    return (
      <div ref={ref} className="flex h-full w-full items-center gap-2 px-3.5 sm:px-4">
        {zones.map((zone, i) => (
          <Fragment key={i}>
            {i > 0 && divider}
            {zone}
          </Fragment>
        ))}
      </div>
    );
  }

  return (
    <div ref={ref} className="flex min-h-[70px] w-full flex-col px-4 py-3">
      {listTriggerMobile}
      <div ref={collapsibleRef} id="viewer-units-filters">
        <div className="flex flex-col gap-3 pt-3">
          {hasSurface && (
            <div className="flex flex-col gap-1.5 rounded-control border border-fg/15 px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wide text-fg/50">{t("units.filterSurface")}</span>
                <span className="text-xs font-semibold tabular-nums text-fg">{surfaceLabel}</span>
              </div>
              {surfaceSlider}
            </div>
          )}
          {hasRooms && roomsTriggerMobile}
          {hasAvailability &&
            renderAvailabilityPills("flex items-stretch gap-2 [&>button]:flex-1 [&>button]:justify-center [&>button]:py-2.5")}
        </div>
      </div>
    </div>
  );
});
