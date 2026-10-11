"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { ChevronLeft, ChevronRight, RotateCcw, SlidersHorizontal } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { areaText, numberText } from "@/components/project-structure/structure-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/ui/search-field";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { ORIENTATION_LABELS, POSITION_LABELS, UNIT_ORIENTATIONS, UNIT_POSITIONS, type UnitOrientation } from "@/lib/modules/project-structure/structure.types";
import type { InventorySort } from "@/lib/modules/sales/units/unit-sales.schema";
import { UNIT_COMMERCIAL_STATUS_LABELS, type InventoryDTO, type InventoryRowDTO, type UnitCommercialStatus } from "@/lib/modules/sales/units/unit-sales.types";
import { formatDate } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { salesLabel } from "@/lib/i18n/modules/sales/labels";
import { useSalesTranslations } from "@/components/sales/sales-text";
import { CommercialStatusBadge, moneyLabel, perSqmLabel } from "./commercial-status";
import { FormSelect } from "@/components/ui/form-select";

/**
 * A project's units as Sales sees them (E-05E §13, §14, §55).
 *
 * The canonical units — no copy — filtered, searched and sorted by the server a
 * page at a time. The quick filters say how many units each would show under
 * every other filter. A row opens the unit's one page; on a phone each unit is a
 * card with what decides a sale, and the reserve and release actions the reader
 * may take land on that page's Sales section with the dialog open.
 */

export type InventoryFilters = {
  q: string;
  commercialStatus: string;
  buildingId: string;
  floorId: string;
  unitTypeId: string;
  orientation: string;
  position: string;
  bedrooms: string;
  bathrooms: string;
  areaMin: string;
  areaMax: string;
  priceMin: string;
  priceMax: string;
  pricePerSqmMin: string;
  pricePerSqmMax: string;
  sort: InventorySort;
};

export const EMPTY_INVENTORY_FILTERS: InventoryFilters = { q: "", commercialStatus: "", buildingId: "", floorId: "", unitTypeId: "", orientation: "", position: "", bedrooms: "", bathrooms: "", areaMin: "", areaMax: "", priceMin: "", priceMax: "", pricePerSqmMin: "", pricePerSqmMax: "", sort: "structure" };

const PANEL_KEYS = ["buildingId", "floorId", "unitTypeId", "orientation", "position", "bedrooms", "bathrooms", "areaMin", "areaMax", "priceMin", "priceMax", "pricePerSqmMin", "pricePerSqmMax"] as const;
const QUICK: Array<UnitCommercialStatus | ""> = ["", "FOR_SALE", "ON_HOLD", "RESERVED", "SOLD", "NOT_FOR_SALE"];
const SORT_LABELS: Record<InventorySort, string> = {
  structure: "Building and floor",
  code: "Unit code",
  price: "Price, low to high",
  "-price": "Price, high to low",
  pricePerSqm: "Price/m², low to high",
  "-pricePerSqm": "Price/m², high to low",
  area: "Area, small to large",
  "-area": "Area, large to small",
  expiry: "Reservation expiry",
};

type Place = { id: string; name: string; floors: Array<{ id: string; name: string }> };

function queryString(filters: InventoryFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.commercialStatus) params.set("commercialStatus", filters.commercialStatus);
  for (const key of PANEL_KEYS) if (filters[key]) params.set(key, filters[key]);
  if (filters.sort !== "structure") params.set("sort", filters.sort);
  if (page > 1) params.set("page", String(page));
  return params.toString();
}

export function SalesInventory({
  projectId,
  initial,
  initialFilters,
  buildings,
  unitTypes,
  actions,
}: {
  projectId: string;
  initial: InventoryDTO;
  initialFilters: InventoryFilters;
  buildings: Place[];
  unitTypes: Array<{ id: string; name: string }>;
  actions: { canReserve: boolean; canRelease: boolean };
}) {
  const t = useSalesTranslations();
  const tUi = useTranslations("ui");
  const [filters, setFilters] = React.useState(initialFilters);
  const [search, setSearch] = React.useState(initialFilters.q);
  const [page, setPage] = React.useState(initial.page);
  const [list, setList] = React.useState(initial);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [panelOpen, setPanelOpen] = React.useState(PANEL_KEYS.some((key) => initialFilters[key]));
  const firstLoad = React.useRef(true);

  const panelCount = PANEL_KEYS.filter((key) => filters[key]).length;
  const active = panelCount + (filters.q.trim() ? 1 : 0) + (filters.commercialStatus ? 1 : 0);
  const floors = buildings.find((building) => building.id === filters.buildingId)?.floors ?? buildings.flatMap((building) => building.floors.map((floor) => ({ ...floor, name: `${building.name} · ${floor.name}` })));

  React.useEffect(() => {
    const timer = window.setTimeout(() => setFilters((current) => (current.q === search ? current : { ...current, q: search })), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  React.useEffect(() => {
    const url = new URL(window.location.href);
    url.search = queryString(filters, page);
    window.history.replaceState(window.history.state, "", url.toString());
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    fetch(`/api/projects/${projectId}/sales/units?${queryString(filters, page)}`, { signal: controller.signal })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as { data?: InventoryDTO; error?: { message?: string } } | null;
        if (!response.ok || !json?.data) throw new Error(json?.error?.message ?? t("inventory.loadFailed"));
        setList(json.data);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : t("inventory.loadFailed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters, page, projectId, reloadKey, t]);

  function setFilter(patch: Partial<InventoryFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  function clear() {
    setSearch("");
    setFilters({ ...EMPTY_INVENTORY_FILTERS, sort: filters.sort });
    setPage(1);
  }

  const href = (row: InventoryRowDTO) => `/projects/${projectId}/units/${row.id}`;
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const first = list.total ? (list.page - 1) * list.pageSize + 1 : 0;
  const last = Math.min(list.page * list.pageSize, list.total);

  return (
    <div className="space-y-3">
      <div className="-mx-1 overflow-x-auto">
        <div className="flex min-w-max gap-1.5 px-1" role="group" aria-label={t("inventory.statusGroup")}>
          {QUICK.map((status) => {
            const pressed = filters.commercialStatus === status;
            return (
              <button
                key={status || "ALL"}
                type="button"
                aria-pressed={pressed}
                data-testid="sales-quick-filter"
                data-status={status || "ALL"}
                onClick={() => setFilter({ commercialStatus: status })}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-table font-medium transition-colors touch:h-11", pressed ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg")}
              >
                {status ? salesLabel(t, "commercialStatus", status, UNIT_COMMERCIAL_STATUS_LABELS[status]) : t("inventory.all")}
                <span className={cn("tabular-nums", pressed ? "opacity-90" : "text-fg-subtle")}>{list.counts[status || "ALL"]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          className="w-full sm:w-auto sm:min-w-0 sm:max-w-xs sm:flex-1"
          placeholder={list.canSeeClients || list.canSeeDeals ? t("inventory.searchWide") : t("inventory.searchNarrow")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label={t("inventory.searchUnits")}
        />
        <Button variant="secondary" onClick={() => setPanelOpen((open) => !open)} aria-expanded={panelOpen}>
          <SlidersHorizontal aria-hidden="true" />
          {tUi("filters")}{panelCount ? ` (${panelCount})` : ""}
        </Button>
        <FormSelect aria-label={t("inventory.sortUnits")} className={cn(selectClass, "w-auto")} value={filters.sort} onChange={(event) => setFilter({ sort: event.target.value as InventorySort })}>
          {(Object.keys(SORT_LABELS) as InventorySort[]).map((sort) => (
            <option key={sort} value={sort}>
              {t(`inventory.sort.${sort}` as "inventory.sort.code")}
            </option>
          ))}
        </FormSelect>
        {active ? (
          <Button variant="ghost" onClick={clear}>
            <RotateCcw aria-hidden="true" />
            {t("inventory.clearFilters")}
          </Button>
        ) : null}
      </div>

      {panelOpen ? (
        <div className="grid grid-cols-2 gap-3 rounded-md border border-line bg-surface-muted p-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="sales-filters">
          <FilterSelect label={t("inventory.building")} value={filters.buildingId} onChange={(buildingId) => setFilter({ buildingId, floorId: "" })} options={buildings.map((building) => ({ value: building.id, label: building.name }))} />
          <FilterSelect label={t("inventory.floor")} value={filters.floorId} onChange={(floorId) => setFilter({ floorId })} options={floors.map((floor) => ({ value: floor.id, label: floor.name }))} />
          <FilterSelect label={t("inventory.unitType")} value={filters.unitTypeId} onChange={(unitTypeId) => setFilter({ unitTypeId })} options={unitTypes.map((type) => ({ value: type.id, label: type.name }))} />
          <FilterSelect label={t("inventory.bedrooms")} value={filters.bedrooms} onChange={(bedrooms) => setFilter({ bedrooms })} options={[0, 1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value) }))} />
          <FilterSelect label={t("inventory.bathrooms")} value={filters.bathrooms} onChange={(bathrooms) => setFilter({ bathrooms })} options={[0, 1, 2, 3, 4].map((value) => ({ value: String(value), label: String(value) }))} />
          <FilterSelect label={t("inventory.orientation")} value={filters.orientation} onChange={(orientation) => setFilter({ orientation })} options={UNIT_ORIENTATIONS.map((value) => ({ value, label: ORIENTATION_LABELS[value] }))} />
          <FilterSelect label={t("inventory.position")} value={filters.position} onChange={(position) => setFilter({ position })} options={UNIT_POSITIONS.map((value) => ({ value, label: POSITION_LABELS[value] }))} />
          <RangeFilter label={t("inventory.saleableArea")} min={filters.areaMin} max={filters.areaMax} onChange={(areaMin, areaMax) => setFilter({ areaMin, areaMax })} />
          <RangeFilter label={t("inventory.askingPrice")} min={filters.priceMin} max={filters.priceMax} onChange={(priceMin, priceMax) => setFilter({ priceMin, priceMax })} />
          <RangeFilter label={t("inventory.pricePerSqm")} min={filters.pricePerSqmMin} max={filters.pricePerSqmMax} onChange={(pricePerSqmMin, pricePerSqmMax) => setFilter({ pricePerSqmMin, pricePerSqmMax })} />
        </div>
      ) : null}

      {loadError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong" role="alert">
          <span>{loadError}</span>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            {t("inventory.retry")}
          </Button>
        </div>
      ) : list.items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong bg-surface-muted px-4 py-10 text-center text-table text-fg-muted" data-testid="sales-none">
          {active ? t("inventory.noMatch") : t("inventory.noUnits")}
        </p>
      ) : (
        <div className={loading ? "opacity-60 transition-opacity" : undefined} aria-busy={loading}>
          {active ? <p className="mb-2 text-table text-fg-muted">{t("inventory.unitCount", { count: list.total })}</p> : null}
          <div className="hidden md:block">
            <Table label={t("inventory.table")} data-testid="sales-table">
              <TableHead>
                <tr>
                  <TableHeaderCell>{t("inventory.unit")}</TableHeaderCell>
                  <TableHeaderCell>{t("inventory.location")}</TableHeaderCell>
                  <TableHeaderCell className="text-right">{t("inventory.saleable")}</TableHeaderCell>
                  <TableHeaderCell className="text-right">{t("inventory.beds")}</TableHeaderCell>
                  <TableHeaderCell className="hidden 2xl:table-cell">{t("inventory.orientation")}</TableHeaderCell>
                  <TableHeaderCell>{t("inventory.status")}</TableHeaderCell>
                  <TableHeaderCell className="text-right">{t("inventory.askingPrice")}</TableHeaderCell>
                  <TableHeaderCell className="text-right">{t("inventory.pricePerSqm")}</TableHeaderCell>
                  {list.canSeeClients ? <TableHeaderCell>{t("inventory.client")}</TableHeaderCell> : null}
                  {list.canSeeDeals ? <TableHeaderCell>{t("inventory.deal")}</TableHeaderCell> : null}
                  <TableHeaderCell>{t("inventory.expires")}</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {list.items.map((row) => (
                  <TableRow key={row.id} data-testid="sales-row" data-unit-code={row.unitCode}>
                    <TableCell className="whitespace-nowrap">
                      <Link href={href(row)} className="font-medium text-fg hover:text-accent-strong">
                        {row.unitCode}
                      </Link>
                      <span className="block text-meta text-fg-subtle">{row.unitType}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.building}
                      <span className="block text-meta text-fg-subtle">{row.floor}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{areaText(row.saleableArea)}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.bedrooms ?? "—"}</TableCell>
                    <TableCell className="hidden text-fg-muted 2xl:table-cell">{row.orientation ? ORIENTATION_LABELS[row.orientation as UnitOrientation] : "—"}</TableCell>
                    <TableCell>
                      <CommercialStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{moneyLabel(row.askingPrice, row.currency)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-fg-muted">{perSqmLabel(row.pricePerSqm, row.currency)}</TableCell>
                    {list.canSeeClients ? <TableCell className="max-w-[10rem] truncate">{row.client ? <Link href={`/clients/${row.client.id}`} className="hover:underline">{row.client.name}</Link> : "—"}</TableCell> : null}
                    {list.canSeeDeals ? <TableCell className="max-w-[10rem] truncate">{row.deal ? <Link href={`/sales/opportunities/${row.deal.id}`} className="hover:underline">{row.deal.name}</Link> : "—"}</TableCell> : null}
                    <TableCell className="whitespace-nowrap text-fg-muted">{row.reservationExpiresAt ? formatDate(row.reservationExpiresAt) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="space-y-2 md:hidden" data-testid="sales-cards">
            {list.items.map((row) => (
              <li key={row.id} className="nesto-card p-3" data-testid="sales-card" data-unit-code={row.unitCode}>
                <Link href={href(row)} className="block min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-body font-semibold text-fg">{row.unitCode}</span>
                    <CommercialStatusBadge status={row.status} />
                    <span className="ml-auto text-body font-medium tabular-nums text-fg">{moneyLabel(row.askingPrice, row.currency)}</span>
                  </span>
                  <span className="mt-0.5 block text-meta text-fg-subtle">
                    {row.building} · {row.floor} · {areaText(row.saleableArea)}
                    {row.pricePerSqm !== null ? ` · ${perSqmLabel(row.pricePerSqm, row.currency)}` : null}
                  </span>
                  {row.client || row.reservationExpiresAt ? (
                    <span className="mt-1 block text-meta text-fg-muted">
                      {row.client ? row.client.name : null}
                      {row.client && row.reservationExpiresAt ? " · " : null}
                      {row.reservationExpiresAt ? t("inventory.expiresOn", { date: formatDate(row.reservationExpiresAt) }) : null}
                    </span>
                  ) : null}
                </Link>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button asChild variant="secondary" size="sm">
                    <Link href={href(row)}>{t("inventory.open")}</Link>
                  </Button>
                  {/* The table's Deal column, so a phone reaches the unit's deal too (AUD-04 §5, MW-05). */}
                  {list.canSeeDeals && row.deal ? (
                    <Button asChild variant="secondary" size="sm" className="max-w-full">
                      <Link href={`/sales/opportunities/${row.deal.id}`} aria-label={t("inventory.dealLabel", { name: row.deal.name })}>
                        <span className="truncate">{t("inventory.dealLabel", { name: row.deal.name })}</span>
                      </Link>
                    </Button>
                  ) : null}
                  {actions.canReserve && (row.status === "FOR_SALE" || row.status === "ON_HOLD") && row.publicationStatus === "PUBLISHED" ? (
                    <Button asChild size="sm">
                      <Link href={`${href(row)}/sales?action=reserve`}>{t("inventory.reserve")}</Link>
                    </Button>
                  ) : null}
                  {actions.canRelease && row.status === "RESERVED" ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={`${href(row)}/sales?action=release`}>{t("inventory.release")}</Link>
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          {list.total > list.pageSize ? (
            <nav aria-label={t("inventory.pagination")} className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-table text-fg-muted">
                <span className="tabular-nums">
                  {first}–{last}
                </span>{" "}
                {t("inventory.of")} <span className="tabular-nums">{list.total}</span>
              </p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={list.page <= 1 || loading} onClick={() => setPage(list.page - 1)}>
                  <ChevronLeft aria-hidden="true" />
                  {t("inventory.previous")}
                </Button>
                <span className="text-table tabular-nums text-fg-subtle">
                  {t("inventory.pageOf", { page: list.page, pages })}
                </span>
                <Button variant="secondary" size="sm" disabled={list.page >= pages || loading} onClick={() => setPage(list.page + 1)}>
                  {t("inventory.next")}
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            </nav>
          ) : null}
        </div>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  const t = useSalesTranslations();
  const id = `sales-filter-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-meta font-medium text-fg-muted">
        {label}
      </label>
      <FormSelect id={id} className={cn(selectClass, "h-9")} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t("inventory.any")}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </FormSelect>
    </div>
  );
}

function RangeFilter({ label, min, max, onChange }: { label: string; min: string; max: string; onChange: (min: string, max: string) => void }) {
  const t = useSalesTranslations();
  const [low, setLow] = React.useState(min);
  const [high, setHigh] = React.useState(max);
  React.useEffect(() => {
    setLow(min);
    setHigh(max);
  }, [min, max]);
  const apply = () => {
    const valid = (value: string) => (/^\d{1,16}(\.\d{1,2})?$/.test(value) ? value : "");
    if (valid(low) !== min || valid(high) !== max) onChange(valid(low), valid(high));
  };
  return (
    <fieldset className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
      <legend className="mb-1 text-meta font-medium text-fg-muted">{label}</legend>
      <div className="flex items-center gap-1.5">
        <Input aria-label={t("inventory.from", { label })} placeholder={t("inventory.min")} inputMode="decimal" className="h-9" value={low} onChange={(event) => setLow(numberText(event.target.value))} onBlur={apply} onKeyDown={(event) => event.key === "Enter" && apply()} />
        <span className="text-fg-subtle">–</span>
        <Input aria-label={t("inventory.to", { label })} placeholder={t("inventory.max")} inputMode="decimal" className="h-9" value={high} onChange={(event) => setHigh(numberText(event.target.value))} onBlur={apply} onKeyDown={(event) => event.key === "Enter" && apply()} />
      </div>
    </fieldset>
  );
}
