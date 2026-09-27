"use client";

import { Bath, BedDouble, Building2, ExternalLink, Heart, Layers, Ruler } from "lucide-react";
import Link from "@/components/navigation/nav-link";
import { useT } from "@/lib/3d/viewer/i18n";
import { cn } from "@/lib/3d/viewer/utils";
import type { Currency, Unit } from "@/lib/3d/viewer/types";
import type { AreaUnit } from "@/components/3d/viewer/hooks/useViewerPreferences";
import { bedroomLabel } from "./unitFilters";
import { formatUnitArea, unitPriceLabel } from "./unitDisplay";

const STATUS_DOT: Record<Unit["status"], string> = {
  available: "bg-emerald-400",
  reserved: "bg-amber-400",
  sold: "bg-red-400",
};

export function UnitDetailView({
  unit,
  isFavorite,
  onToggleFavorite,
  displayCurrency,
  eurToAllRate,
  areaUnit,
}: {
  unit: Unit;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  displayCurrency: Currency;
  eurToAllRate: number;
  areaUnit: AreaUnit;
}) {
  const { t } = useT();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="aspect-[4/3] w-full bg-gradient-to-br from-white/10 to-white/[0.02]" aria-hidden="true" />
      <div className="flex gap-1.5 border-b border-white/10 px-4 py-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-10 w-14 shrink-0 rounded-control bg-gradient-to-br from-white/10 to-white/[0.02]" aria-hidden="true" />
        ))}
      </div>

      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-white/40">{unit.buildingName}</p>
            <h2 className="text-lg font-semibold text-white">{unit.code}</h2>
          </div>
          <button
            type="button"
            onClick={onToggleFavorite}
            aria-pressed={isFavorite}
            aria-label={t("units.favorite")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-white/50 hover:bg-white/10 hover:text-white"
          >
            <Heart className={cn("h-4 w-4", isFavorite && "fill-brand-400 text-brand-400")} />
          </button>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-2xl font-semibold text-white">
            {unitPriceLabel(unit, displayCurrency, eurToAllRate, t("projectDetail.priceOnRequest"))}
          </span>
          <span className="flex items-center gap-1.5 rounded-pill bg-white/5 px-2.5 py-1 text-xs font-medium text-white/70">
            <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[unit.status])} aria-hidden="true" />
            {t(`units.status.${unit.status}`)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: Layers, label: t("units.detail.floor"), value: t("units.floorLabel", { floor: unit.floor }) },
            { icon: BedDouble, label: t("units.detail.type"), value: bedroomLabel(unit.bedrooms) },
            { icon: Ruler, label: t("units.detail.area"), value: formatUnitArea(unit.area, areaUnit) },
            { icon: Bath, label: t("units.detail.bathrooms"), value: String(unit.bathrooms) },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="rounded-control border border-white/5 bg-white/[0.03] p-2.5">
              <Icon className="mb-1 h-3.5 w-3.5 text-white/40" aria-hidden="true" />
              <p className="text-[11px] text-white/40">{label}</p>
              <p className="text-sm font-medium text-white">{value}</p>
            </div>
          ))}
        </div>

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-white/50">
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t("units.detail.floorPlan")}
          </p>
          {unit.floorPlanImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- a signed-in thumbnail route, not an optimisable static asset
            <img src={unit.floorPlanImage} alt="" className="aspect-[16/10] w-full rounded-control bg-white/5 object-contain" loading="lazy" />
          ) : (
            <div className="aspect-[16/10] w-full rounded-control bg-gradient-to-br from-white/10 to-white/[0.02]" aria-hidden="true" />
          )}
        </div>

        {unit.href && (
          <Link
            href={unit.href}
            className="flex w-full items-center justify-center gap-1.5 rounded-control bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600"
          >
            Open unit record
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}

        <button
          type="button"
          disabled
          title={t("units.moreComingSoon")}
          className="flex w-full items-center justify-center rounded-control bg-brand-500/40 px-4 py-2.5 text-sm font-semibold text-white/70"
        >
          {t("units.detail.contact")}
        </button>
      </div>
    </div>
  );
}
