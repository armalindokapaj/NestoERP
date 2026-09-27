"use client";

import { useMemo, useState } from "react";
import { BedDouble, Bath, Ruler, X } from "lucide-react";
import type { Project, Unit } from "@/lib/3d/viewer/types";
import { usePriceFormat } from "@/components/3d/viewer/hooks/usePriceFormat";
import { useT } from "@/lib/3d/viewer/i18n";
import { cn, formatArea, formatPrice } from "@/lib/3d/viewer/utils";
import { PlaceholderImage } from "@/components/3d/viewer/shared/PlaceholderImage";
import { FilterDropdown } from "@/components/3d/viewer/shared/FilterDropdown";
import { RangeSlider, type SliderScale } from "@/components/3d/viewer/shared/RangeSlider";

const STATUS_STYLE: Record<Unit["status"], string> = {
  available: "border-success text-success bg-success/10",
  reserved: "border-warning text-warning bg-warning/10",
  sold: "border-sold text-sold bg-neutral-100",
};

const STATUS_LABEL_KEY: Record<Unit["status"], string> = {
  available: "unit.statusAvailable",
  reserved: "unit.statusReserved",
  sold: "unit.statusSold",
};

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-brand-500 bg-brand-500 text-white"
          : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
      )}
    >
      {children}
    </button>
  );
}

export function UnitDiscoveryPanel({
  project,
  open,
  onClose,
  onSelectUnit,
}: {
  project: Project;
  open: boolean;
  onClose: () => void;
  onSelectUnit: (unit: Unit) => void;
}) {
  const [building, setBuilding] = useState<string | "all">("all");
  const [bedrooms, setBedrooms] = useState<number | null>(null);
  const [bathrooms, setBathrooms] = useState<number | null>(null);
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [availability, setAvailability] = useState<"all" | Unit["status"]>("all");
  const priceFmt = usePriceFormat();
  const { t } = useT();

  const priceScale: SliderScale = useMemo(() => {
    const prices = project.units.flatMap((u) => (u.price == null ? [] : [u.price]));
    const min = prices.length ? Math.floor(Math.min(...prices) / 5000) * 5000 : 0;
    const max = prices.length ? Math.ceil(Math.max(...prices) / 5000) * 5000 : 10000;
    return { min, max: max > min ? max : min + 5000, step: 5000 };
  }, [project.units]);

  const units = useMemo(() => {
    return project.units.filter((u) => {
      if (building !== "all" && u.buildingName !== building) return false;
      if (bedrooms !== null && u.bedrooms < bedrooms) return false;
      if (bathrooms !== null && u.bathrooms < bathrooms) return false;
      if (priceMin != null && (u.price == null || u.price < priceMin)) return false;
      if (priceMax != null && (u.price == null || u.price > priceMax)) return false;
      if (availability !== "all" && u.status !== availability) return false;
      return true;
    });
  }, [project.units, building, bedrooms, bathrooms, priceMin, priceMax, availability]);

  const isDefault =
    building === "all" &&
    bedrooms === null &&
    bathrooms === null &&
    priceMin == null &&
    priceMax == null &&
    availability === "all";

  function resetFilters() {
    setBuilding("all");
    setBedrooms(null);
    setBathrooms(null);
    setPriceMin(null);
    setPriceMax(null);
    setAvailability("all");
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex max-h-[85vh] flex-col rounded-t-panel bg-white shadow-[var(--shadow-2)] lg:inset-y-0 lg:right-0 lg:left-auto lg:top-0 lg:h-full lg:max-h-none lg:w-[560px] lg:rounded-l-panel lg:rounded-tr-none"
      role="dialog"
      aria-label={t("unit.availableUnitsTitle")}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-100 px-5 py-4">
        <div>
          <h2 className="text-base font-bold text-neutral-900">{t("unit.availableUnitsTitle")}</h2>
          <p className="text-xs text-neutral-500">
            {t("unit.unitsMatch", { matched: units.length, total: project.units.length })}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label={t("unit.closeUnitDiscovery")}
          className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="shrink-0 border-b border-neutral-100 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {project.buildings.length > 1 && (
            <FilterDropdown
              label={building === "all" ? t("unit.allBuildings") : t("unit.buildingLabel", { name: building })}
              active={building !== "all"}
            >
              {() => (
                <div className="flex flex-wrap gap-1.5">
                  <Pill active={building === "all"} onClick={() => setBuilding("all")}>
                    {t("unit.allBuildings")}
                  </Pill>
                  {project.buildings.map((b) => (
                    <Pill key={b} active={building === b} onClick={() => setBuilding(b)}>
                      {t("unit.buildingLabel", { name: b })}
                    </Pill>
                  ))}
                </div>
              )}
            </FilterDropdown>
          )}

          <FilterDropdown
            label={bedrooms == null ? t("unit.anyBeds") : t("unit.bedPlus", { count: bedrooms })}
            active={bedrooms != null}
          >
            {() => (
              <div className="flex flex-wrap gap-1.5">
                {[null, 1, 2, 3, 4].map((v) => (
                  <Pill key={String(v)} active={bedrooms === v} onClick={() => setBedrooms(v)}>
                    {v === null ? t("unit.anyBeds") : t("unit.bedPlus", { count: v })}
                  </Pill>
                ))}
              </div>
            )}
          </FilterDropdown>

          <FilterDropdown
            label={bathrooms == null ? t("filters.bathrooms") : t("filters.countPlus", { count: bathrooms })}
            active={bathrooms != null}
          >
            {() => (
              <div className="flex flex-wrap gap-1.5">
                {[null, 1, 2].map((v) => (
                  <Pill key={String(v)} active={bathrooms === v} onClick={() => setBathrooms(v)}>
                    {v === null ? t("common.any") : t("filters.countPlus", { count: v })}
                  </Pill>
                ))}
              </div>
            )}
          </FilterDropdown>

          {project.commercialVisible && (
            <FilterDropdown
              label={
                priceMin == null && priceMax == null
                  ? t("filters.priceShort")
                  : `${formatPrice(priceMin ?? priceScale.min, "EUR", { compact: true })}–${
                      priceMax != null ? formatPrice(priceMax, "EUR", { compact: true }) : "+"
                    }`
              }
              active={priceMin != null || priceMax != null}
              align="right"
            >
              {() => (
                <RangeSlider
                  scale={priceScale}
                  valueMin={priceMin}
                  valueMax={priceMax}
                  onChange={(min, max) => {
                    setPriceMin(min);
                    setPriceMax(max);
                  }}
                  formatValue={(v) => formatPrice(v, "EUR", { compact: v > 99_000 })}
                  ariaLabel={t("filters.priceRangeAria")}
                />
              )}
            </FilterDropdown>
          )}

          <FilterDropdown
            label={availability === "all" ? t("unit.viewerFilterAll") : t(STATUS_LABEL_KEY[availability])}
            active={availability !== "all"}
            align="right"
          >
            {() => (
              <div className="flex flex-wrap gap-1.5">
                {(["all", "available", "reserved", "sold"] as const).map((s) => (
                  <Pill key={s} active={availability === s} onClick={() => setAvailability(s)}>
                    {s === "all" ? t("unit.viewerFilterAll") : t(STATUS_LABEL_KEY[s])}
                  </Pill>
                ))}
              </div>
            )}
          </FilterDropdown>

          {!isDefault && (
            <button
              onClick={resetFilters}
              className="shrink-0 rounded-pill px-2 py-1.5 text-xs font-medium text-neutral-500 hover:text-brand-600"
            >
              {t("filters.resetAllFilters")}
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin p-4">
        {units.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-500">{t("unit.noUnitsMatch")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {units.map((unit) => (
              <button
                key={unit.id}
                onClick={() => onSelectUnit(unit)}
                disabled={unit.status === "sold"}
                className={cn(
                  "flex flex-col overflow-hidden rounded-card border text-left transition-colors",
                  unit.status === "sold"
                    ? "cursor-not-allowed border-neutral-100 opacity-60"
                    : "border-neutral-200 hover:border-brand-300 hover:shadow-[var(--shadow-1)]"
                )}
              >
                <div className="relative aspect-[4/3] w-full shrink-0">
                  <PlaceholderImage seed={unit.id} kind="floorplan" className="h-full w-full" />
                  <span
                    className={cn(
                      "absolute left-2 top-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize",
                      STATUS_STYLE[unit.status]
                    )}
                  >
                    {t(STATUS_LABEL_KEY[unit.status])}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <p className="text-sm font-bold text-neutral-900">
                    {priceFmt(unit.price, { compact: true, currency: unit.currency })}
                  </p>
                  <p className="truncate text-xs font-medium text-neutral-700">
                    {unit.code} · {t("unit.floorLabel", { n: unit.floor })}
                  </p>
                  <div className="mt-auto flex items-center gap-3 pt-1 text-xs text-neutral-500">
                    <span className="flex items-center gap-1">
                      <BedDouble className="h-3.5 w-3.5" /> {unit.bedrooms}
                    </span>
                    <span className="flex items-center gap-1">
                      <Bath className="h-3.5 w-3.5" /> {unit.bathrooms}
                    </span>
                    <span className="flex items-center gap-1">
                      <Ruler className="h-3.5 w-3.5" /> {formatArea(unit.area)}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
