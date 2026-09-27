"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { gsap } from "gsap";
import { ArrowLeft, X } from "lucide-react";
import { useT } from "@/lib/3d/viewer/i18n";
import { useEffectiveReducedMotion } from "@/components/3d/viewer/hooks/useEffectiveReducedMotion";
import { useViewerStore } from "@/lib/3d/viewer/store";
import { useViewerPreferences } from "@/components/3d/viewer/hooks/useViewerPreferences";
import type { Unit } from "@/lib/3d/viewer/types";
import { UnitSearchView, UNITS_PAGE_SIZE } from "./UnitSearchView";
import { UnitDetailView } from "./UnitDetailView";
import type { UnitFilterState } from "./unitFilters";

const PANEL_WIDTH = 380;

export function UnitsWorkspace({
  open,
  onClose,
  units,
  selectedUnitId,
  onSelectUnit,
  unmappedUnitId,
  filters,
  onFiltersChange,
}: {
  open: boolean;
  onClose: () => void;
  units: Unit[];
  selectedUnitId: string | null;
  onSelectUnit: (unitId: string | null) => void;
  unmappedUnitId: string | null;
  filters: UnitFilterState;
  onFiltersChange: Dispatch<SetStateAction<UnitFilterState>>;
}) {
  const { t } = useT();
  const reducedMotion = useEffectiveReducedMotion();
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const selectedUnit = useMemo(() => units.find((u) => u.id === selectedUnitId) ?? null, [units, selectedUnitId]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [visibleCount, setVisibleCount] = useState(UNITS_PAGE_SIZE);
  const displayCurrency = useViewerStore((s) => s.currency);
  const eurToAllRate = useViewerStore((s) => s.eurToAllRate);
  const { areaUnit } = useViewerPreferences();

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const dur = reducedMotion ? 0.001 : open ? 0.48 : 0.4;
    const ease = open ? "power2.out" : "power2.in";
    const delay = open && !reducedMotion ? 0.25 : 0;
    const tl = gsap.timeline({ delay });
    tl.to(outer, { width: open ? PANEL_WIDTH : 0, duration: dur, ease }, 0).to(
      inner,
      { x: open ? 0 : -PANEL_WIDTH, duration: dur, ease },
      0
    );
    return () => {
      tl.kill();
    };
  }, [open, reducedMotion]);

  function toggleFavorite(id: string) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelectUnit(unit: Unit) {
    onSelectUnit(unit.id);
    setDetailOpen(true);
  }

  function handleBackToSearch() {
    setDetailOpen(false);
  }

  function handleClose() {
    setDetailOpen(false);
    onSelectUnit(null);
    onClose();
  }

  return (
    <div
      ref={outerRef}
      className="relative h-full shrink-0 overflow-hidden"
      style={{ width: 0 }}
      aria-hidden={!open}
    >
      <div
        ref={innerRef}
        className="viewer-glass absolute inset-y-0 left-0 flex h-full flex-col"
        style={{
          width: PANEL_WIDTH,
          transform: "translateX(-100%)",
          borderTop: 0,
          borderBottom: 0,
          borderLeft: 0,
        }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3.5">
          {detailOpen && selectedUnit ? (
            <button
              type="button"
              onClick={handleBackToSearch}
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-white/70 hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              {t("units.backToSearch")}
            </button>
          ) : (
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">{t("units.title")}</span>
          )}
          <button
            type="button"
            onClick={handleClose}
            aria-label={t("units.close")}
            title={t("units.close")}
            className="flex h-8 w-8 items-center justify-center rounded-control text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {detailOpen && selectedUnit ? (
          <UnitDetailView
            unit={selectedUnit}
            isFavorite={favorites.has(selectedUnit.id)}
            onToggleFavorite={() => toggleFavorite(selectedUnit.id)}
            displayCurrency={displayCurrency}
            eurToAllRate={eurToAllRate}
            areaUnit={areaUnit}
          />
        ) : (
          <UnitSearchView
            units={units}
            selectedUnitId={selectedUnitId}
            unmappedUnitId={unmappedUnitId}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onSelectUnit={handleSelectUnit}
            filters={filters}
            onFiltersChange={onFiltersChange}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            visibleCount={visibleCount}
            onVisibleCountChange={setVisibleCount}
            displayCurrency={displayCurrency}
            eurToAllRate={eurToAllRate}
            areaUnit={areaUnit}
          />
        )}
      </div>
    </div>
  );
}
