"use client";

import * as React from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/ui/search-field";
import { parseOptionalDecimal, type DecimalRule } from "@/lib/forms/decimal";
import { floorName, unitTypeName } from "@/lib/i18n/stock-names";
import { COUNT_CHOICES, UNIT_ORIENTATIONS } from "@/lib/modules/project-structure/structure.types";
import { UNIT_PUBLICATION_FILTER_STATUSES } from "@/lib/modules/project-structure/unit-publishing.types";
import { cn } from "@/lib/utils/cn";
import { areaRule, numberText } from "../structure-ui";
import { activeCount, FILTER_FIELDS, panelCount, SORTS, type FilterField, type UnitListFilters, type UnitListKind } from "../unit-filters";

/**
 * The one toolbar both unit lists use (2026-11-09): a search, one Filters
 * panel with the same fields wherever they apply, one sort list, and Clear.
 * Units chooses the building and floor in its tree, so its panel has none;
 * Sales has no tree, so its panel does, and Units alone filters archived units.
 */

type Place = { id: string; name: string; floors: Array<{ id: string; name: string }> };

const MONEY: Omit<DecimalRule, "label"> = { scale: 2, maxIntegerDigits: 15 };

export function UnitListToolbar({
  kind,
  filters,
  search,
  onSearch,
  onChange,
  onClear,
  placeholder,
  unitTypes,
  buildings = [],
}: {
  kind: UnitListKind;
  filters: UnitListFilters;
  /** The search box as typed; it reaches the filters when typing pauses. */
  search: string;
  onSearch: (text: string) => void;
  onChange: (patch: Partial<UnitListFilters>) => void;
  onClear: () => void;
  placeholder: string;
  unitTypes: Array<{ id: string; name: string }>;
  /** Sales: the buildings and their floors, for the panel's Building and Floor. */
  buildings?: Place[];
}) {
  const t = useTranslations("projects");
  const locale = useLocale();
  const set = panelCount(filters, kind);
  const [open, setOpen] = React.useState(set > 0);
  const fields = FILTER_FIELDS[kind];
  const floors = buildings.find((building) => building.id === filters.buildingId)?.floors ?? buildings.flatMap((building) => building.floors.map((floor) => ({ ...floor, name: `${building.name} · ${floorName(floor.name, locale)}` })));

  const field = (name: FilterField) => {
    switch (name) {
      case "building":
        return <FilterSelect key={name} id={`${kind}-filter-building`} label={t("workspace.building")} value={filters.buildingId} onChange={(buildingId) => onChange({ buildingId, floorId: "" })} options={buildings.map((building) => ({ value: building.id, label: building.name }))} />;
      case "floor":
        return <FilterSelect key={name} id={`${kind}-filter-floor`} label={t("workspace.floor")} value={filters.floorId} onChange={(floorId) => onChange({ floorId })} options={floors.map((floor) => ({ value: floor.id, label: floorName(floor.name, locale) }))} />;
      case "type":
        return <FilterSelect key={name} id={`${kind}-filter-type`} label={t("workspace.type")} value={filters.unitTypeId} onChange={(unitTypeId) => onChange({ unitTypeId })} options={unitTypes.map((type) => ({ value: type.id, label: unitTypeName(type.name, locale) }))} />;
      case "orientation":
        return <FilterSelect key={name} id={`${kind}-filter-orientation`} label={t("workspace.orientation")} value={filters.orientation} onChange={(orientation) => onChange({ orientation })} options={UNIT_ORIENTATIONS.map((value) => ({ value, label: t(`orientation.${value}`) }))} />;
      case "bedrooms":
        return <FilterSelect key={name} id={`${kind}-filter-bedrooms`} label={t("workspace.bedrooms")} value={filters.bedrooms} onChange={(bedrooms) => onChange({ bedrooms })} options={COUNT_CHOICES.bedrooms.map((value) => ({ value: String(value), label: String(value) }))} />;
      case "bathrooms":
        return <FilterSelect key={name} id={`${kind}-filter-bathrooms`} label={t("workspace.bathrooms")} value={filters.bathrooms} onChange={(bathrooms) => onChange({ bathrooms })} options={COUNT_CHOICES.bathrooms.map((value) => ({ value: String(value), label: String(value) }))} />;
      case "area":
        return <RangeFilter key={name} label={t("workspace.saleArea")} rule={areaRule(t("workspace.saleArea"))} min={filters.areaMin} max={filters.areaMax} onChange={(areaMin, areaMax) => onChange({ areaMin, areaMax })} />;
      case "price":
        return <RangeFilter key={name} label={t("workspace.totalPrice")} rule={{ label: t("workspace.totalPrice"), ...MONEY }} min={filters.priceMin} max={filters.priceMax} onChange={(priceMin, priceMax) => onChange({ priceMin, priceMax })} />;
      case "pricePerSqm":
        return <RangeFilter key={name} label={t("workspace.pricePerSqm")} rule={{ label: t("workspace.pricePerSqm"), ...MONEY }} min={filters.pricePerSqmMin} max={filters.pricePerSqmMax} onChange={(pricePerSqmMin, pricePerSqmMax) => onChange({ pricePerSqmMin, pricePerSqmMax })} />;
      case "publication":
        return <FilterSelect key={name} id={`${kind}-filter-publication`} label={t("workspace.publication")} value={filters.publication} onChange={(publication) => onChange({ publication })} options={UNIT_PUBLICATION_FILTER_STATUSES.map((value) => ({ value, label: t(`publication.${value}`) }))} />;
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchField className="w-full sm:w-auto sm:min-w-0 sm:max-w-xs sm:flex-1" placeholder={placeholder} value={search} onChange={(event) => onSearch(event.target.value)} aria-label={t("workspace.searchLabel")} />
        <Button variant="secondary" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
          <SlidersHorizontal aria-hidden="true" />
          {t("workspace.filters")}
          {set ? ` (${set})` : ""}
        </Button>
        <FormSelect aria-label={t("workspace.sortLabel")} className={cn(selectClass, "w-auto")} value={filters.sort} onChange={(event) => onChange({ sort: event.target.value as UnitListFilters["sort"] })}>
          {SORTS[kind].map((sort) => (
            <option key={sort} value={sort}>
              {t(`unitSort.${sort}`)}
            </option>
          ))}
        </FormSelect>
        {activeCount(filters, kind) ? (
          <Button variant="ghost" onClick={onClear}>
            <RotateCcw aria-hidden="true" />
            {t("workspace.clearFilters")}
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="grid grid-cols-2 gap-3 rounded-md border border-line bg-surface-muted p-3 sm:grid-cols-3 lg:grid-cols-5" data-testid={kind === "sales" ? "sales-filters" : "unit-filters"}>
          {fields.map(field)}
        </div>
      ) : null}
    </>
  );
}

function FilterSelect({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  const t = useTranslations("projects");
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-meta font-medium text-fg-muted">
        {label}
      </label>
      <FormSelect id={id} className={cn(selectClass, "h-9")} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t("workspace.any")}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </FormSelect>
    </div>
  );
}

function RangeFilter({ label, rule, min, max, onChange }: { label: string; rule: DecimalRule; min: string; max: string; onChange: (min: string, max: string) => void }) {
  const t = useTranslations("projects");
  const [low, setLow] = React.useState(min);
  const [high, setHigh] = React.useState(max);
  React.useEffect(() => {
    setLow(min);
    setHigh(max);
  }, [min, max]);
  const apply = () => {
    // Read by the shared locale rule (AUD-09 §4, FV-06): "12,5" is 12.5; an ambiguous "1,234" is not applied.
    const valid = (value: string) => {
      const parsed = parseOptionalDecimal(value, rule);
      return parsed.ok ? (parsed.value ?? "") : "";
    };
    if (valid(low) !== min || valid(high) !== max) onChange(valid(low), valid(high));
  };
  return (
    <fieldset className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
      <legend className="mb-1 text-meta font-medium text-fg-muted">{label}</legend>
      <div className="flex items-center gap-1.5">
        <Input aria-label={t("workspace.from", { label })} placeholder={t("workspace.min")} inputMode="decimal" className="h-9" value={low} onChange={(event) => setLow(numberText(event.target.value))} onBlur={apply} onKeyDown={(event) => event.key === "Enter" && apply()} />
        <span className="text-fg-subtle">–</span>
        <Input aria-label={t("workspace.to", { label })} placeholder={t("workspace.max")} inputMode="decimal" className="h-9" value={high} onChange={(event) => setHigh(numberText(event.target.value))} onBlur={apply} onKeyDown={(event) => event.key === "Enter" && apply()} />
      </div>
    </fieldset>
  );
}
