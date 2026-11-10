"use client";

import * as React from "react";
import { BookmarkCheck, ExternalLink, MoreHorizontal, Tag, Tags, Unlock } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import Link from "@/components/navigation/nav-link";
import { RecordActionSheet, SheetActionButton } from "@/components/data/record-action-sheet";
import { activeCount, EMPTY_FILTERS, filterParams, type UnitListFilters } from "@/components/project-structure/unit-filters";
import { canChangeTogether, fetchSelection, SelectionHelp, useUnitBulk } from "@/components/project-structure/unit-list/unit-bulk";
import { rowFromInventory, selectedFromRow, type UnitListRow } from "@/components/project-structure/unit-list/unit-list-row";
import { UnitListTable } from "@/components/project-structure/unit-list/unit-list-table";
import { UnitListToolbar } from "@/components/project-structure/unit-list/unit-list-toolbar";
import { UnitPanel } from "@/components/project-structure/unit-panel/unit-panel";
import { keepOpenUnit, useUnitPanelNav } from "@/components/project-structure/unit-panel/use-unit-panel";
import type { UnitTypeOption } from "@/lib/modules/project-structure/structure.types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { salesLabel } from "@/lib/i18n/modules/sales/labels";
import { pageState, refreshUnits } from "@/lib/modules/project-structure/unit-bulk.rules";
import { UNIT_SALE_STATUS_LABELS, type InventoryDTO, type UnitSaleStatus } from "@/lib/modules/sales/units/unit-sales.types";
import { cn } from "@/lib/utils/cn";
import { useSalesTranslations } from "@/components/sales/sales-text";

/**
 * A project's units as Sales sees them (E-05E §13, §14, §55).
 *
 * The canonical units — no copy — filtered, searched and sorted by the server a
 * page at a time. The quick filters say how many units each would show under
 * every other filter; a unit nobody has priced reads Not Priced and has its
 * own (2026-11-09). A row opens the unit's Sales section.
 *
 * The table, the toolbar and the tick boxes are the Units tab's own
 * (2026-11-09, "Two tabs, one table"): the same code ("T-501"), the same words
 * and the same sort list, with Sales' columns — the sale area and which area
 * it is, the status, the price per m², and Client, Deal and Expires once a
 * unit on screen is reserved or sold, or the Reserved or Sold chip is chosen.
 * Ticked units take Set price and Put on sale / Take off sale together. A row's
 * menu offers what the reader may do to that unit: open it, set its price, put
 * it on sale or take it off, and reserve or release it on its Sales section
 * with the dialog open (`?action=`).
 *
 * A row opens the unit in the side panel beside the list (2026-11-09) — its
 * details, price and sale-status changes — named in the address as `?unit=`;
 * "Open full page" goes on to its Sales section.
 */

export type InventoryFilters = UnitListFilters;

const QUICK: Array<UnitSaleStatus | ""> = ["", "FOR_SALE", "NOT_PRICED", "ON_HOLD", "RESERVED", "SOLD", "NOT_FOR_SALE"];

type Place = { id: string; name: string; floors: Array<{ id: string; name: string }> };

export type InventoryActions = { canReserve: boolean; canRelease: boolean; canManagePrice: boolean; canManageStatus: boolean; canUpdateUnit: boolean };

function queryString(filters: InventoryFilters, page: number): string {
  const params = filterParams(filters, "sales");
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
  initialOpenUnit = null,
}: {
  projectId: string;
  initial: InventoryDTO;
  initialFilters: InventoryFilters;
  buildings: Place[];
  unitTypes: UnitTypeOption[];
  actions: InventoryActions;
  /** The unit the address opens in the side panel (`?unit=`). */
  initialOpenUnit?: string | null;
}) {
  const t = useSalesTranslations();
  const tp = useTranslations("projects");
  const [filters, setFilters] = React.useState(initialFilters);
  const [search, setSearch] = React.useState(initialFilters.q);
  const [page, setPage] = React.useState(initial.page);
  const [list, setList] = React.useState(initial);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const firstLoad = React.useRef(true);
  const active = activeCount(filters, "sales");
  const panel = useUnitPanelNav(initialOpenUnit);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setFilters((current) => (current.q === search ? current : { ...current, q: search })), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  React.useEffect(() => {
    const url = new URL(window.location.href);
    // The open unit's panel stays open as the list's own query changes.
    url.search = keepOpenUnit(new URLSearchParams(queryString(filters, page))).toString();
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
    setFilters((current) => ({ ...EMPTY_FILTERS, sort: current.sort }));
    setPage(1);
  }

  /* Ticking units and changing them together (2026-11-09) ----------------------- */

  const bulkCaps = { details: false, price: actions.canManagePrice, status: actions.canManageStatus, move: false, archive: false };
  const canTick = canChangeTogether(bulkCaps);
  const shownKey = React.useMemo(() => filterParams({ ...filters, sort: "structure" }, "sales").toString(), [filters]);
  const reload = React.useCallback(() => setReloadKey((key) => key + 1), []);
  const bulk = useUnitBulk({ projectId, caps: bulkCaps, resetKey: shownKey, onChanged: reload });
  const { setSelection: setTicks } = bulk;
  const rows = React.useMemo(() => list.items.map(rowFromInventory), [list]);
  React.useEffect(() => {
    setTicks((current) => refreshUnits(current, rows.map(selectedFromRow)));
  }, [rows, setTicks]);
  const ticks = bulk.selection;
  const pageTicks = pageState(ticks, rows.map((row) => row.id));

  const href = (row: UnitListRow) => `/projects/${projectId}/units/${row.id}`;
  // Sales opens the unit where it is sold: its Sales section, not its Overview (2026-11-09).
  const salesHref = (row: UnitListRow) => `${href(row)}/sales`;
  // The reservation's columns, only once there is something to show in them — or the reader asked for reserved or sold units.
  const showDeal = filters.commercialStatus === "RESERVED" || filters.commercialStatus === "SOLD" || list.items.some((row) => row.status === "RESERVED" || row.status === "SOLD");

  /** What the reader may do to one unit from its row, by their grants and where the unit stands. */
  const offers = (row: UnitListRow) => ({
    price: actions.canManagePrice && row.status !== "SOLD",
    putOnSale: actions.canManageStatus && row.status === "NOT_FOR_SALE" && row.isActive && row.published,
    takeOffSale: actions.canManageStatus && row.status === "FOR_SALE",
    reserve: actions.canReserve && (row.status === "FOR_SALE" || row.status === "ON_HOLD") && row.published,
    release: actions.canRelease && row.status === "RESERVED",
  });

  const rowMenu = (row: UnitListRow) => {
    const can = offers(row);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={tp("unitTable.actionsFor", { code: row.label })} data-testid="sales-row-menu">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={salesHref(row)}>
              <ExternalLink aria-hidden="true" />
              {tp("unitTable.openUnit")}
            </Link>
          </DropdownMenuItem>
          {can.price ? (
            <DropdownMenuItem onSelect={() => bulk.start("price", [selectedFromRow(row)])}>
              <Tag aria-hidden="true" />
              {tp("unitList.action.price")}
            </DropdownMenuItem>
          ) : null}
          {can.putOnSale ? (
            <DropdownMenuItem onSelect={() => bulk.start("put_on_sale", [selectedFromRow(row)])}>
              <Tags aria-hidden="true" />
              {tp("unitList.action.putOnSale")}
            </DropdownMenuItem>
          ) : null}
          {can.takeOffSale ? (
            <DropdownMenuItem onSelect={() => bulk.start("take_off_sale", [selectedFromRow(row)])}>
              <Tags aria-hidden="true" />
              {tp("unitList.action.takeOffSale")}
            </DropdownMenuItem>
          ) : null}
          {can.reserve ? (
            <DropdownMenuItem asChild>
              <Link href={`${salesHref(row)}?action=reserve`}>
                <BookmarkCheck aria-hidden="true" />
                {tp("unitList.action.reserve")}
              </Link>
            </DropdownMenuItem>
          ) : null}
          {can.release ? (
            <DropdownMenuItem asChild>
              <Link href={`${salesHref(row)}?action=release`}>
                <Unlock aria-hidden="true" />
                {tp("unitList.action.release")}
              </Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // A card keeps its Deal, Reserve and Release buttons (AUD-04 §5, MW-05); pricing and the sale status are one sheet.
  const cardActions = (row: UnitListRow) => {
    const can = offers(row);
    return (
      <>
        {list.canSeeDeals && row.deal ? (
          <Button asChild variant="secondary" size="sm" className="max-w-full">
            <Link href={`/sales/opportunities/${row.deal.id}`} aria-label={t("inventory.dealLabel", { name: row.deal.name })}>
              <span className="truncate">{t("inventory.dealLabel", { name: row.deal.name })}</span>
            </Link>
          </Button>
        ) : null}
        {can.reserve ? (
          <Button asChild size="sm">
            <Link href={`${salesHref(row)}?action=reserve`}>{t("inventory.reserve")}</Link>
          </Button>
        ) : null}
        {can.release ? (
          <Button asChild variant="secondary" size="sm">
            <Link href={`${salesHref(row)}?action=release`}>{t("inventory.release")}</Link>
          </Button>
        ) : null}
        {can.price || can.putOnSale || can.takeOffSale ? (
          <RecordActionSheet name={row.label}>
            {can.price ? <SheetActionButton onSelect={() => bulk.start("price", [selectedFromRow(row)])} icon={<Tag aria-hidden="true" />}>{tp("unitList.action.price")}</SheetActionButton> : null}
            {can.putOnSale ? <SheetActionButton onSelect={() => bulk.start("put_on_sale", [selectedFromRow(row)])} icon={<Tags aria-hidden="true" />}>{tp("unitList.action.putOnSale")}</SheetActionButton> : null}
            {can.takeOffSale ? <SheetActionButton onSelect={() => bulk.start("take_off_sale", [selectedFromRow(row)])} icon={<Tags aria-hidden="true" />}>{tp("unitList.action.takeOffSale")}</SheetActionButton> : null}
          </RecordActionSheet>
        ) : null}
      </>
    );
  };

  return (
    <div className="space-y-3">
      {/* A phone pans the status chips; a tablet wraps them, as the row is wider than the page there (mobile audit 2d). */}
      <div className="-mx-1 overflow-x-auto">
        <div className="flex min-w-max gap-1.5 px-1 md:max-lg:min-w-0 md:max-lg:flex-wrap" role="group" aria-label={t("inventory.statusGroup")}>
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
                {status ? salesLabel(t, "commercialStatus", status, UNIT_SALE_STATUS_LABELS[status]) : t("inventory.all")}
                <span className={cn("tabular-nums", pressed ? "opacity-90" : "text-fg-subtle")}>{list.counts[status || "ALL"]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <UnitListToolbar
        kind="sales"
        filters={filters}
        search={search}
        onSearch={setSearch}
        onChange={setFilter}
        onClear={clear}
        placeholder={list.canSeeClients || list.canSeeDeals ? tp("workspace.searchSales") : tp("workspace.searchPlaceholder")}
        unitTypes={unitTypes}
        buildings={buildings}
      />

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
        <div className="space-y-3">
          {active ? <p className="text-table text-fg-muted">{t("inventory.unitCount", { count: list.total })}</p> : null}
          {canTick ? (
            <SelectionHelp
              ticked={ticks.size}
              page={pageTicks}
              total={list.total}
              limit={500}
              onSelectAll={async () => {
                const params = filterParams(filters, "sales");
                params.set("select", "all");
                const found = await fetchSelection(`/api/projects/${projectId}/sales/units?${params.toString()}`);
                bulk.setMany(found.units, true);
              }}
            />
          ) : null}
          <UnitListTable
            kind="sales"
            rows={rows}
            total={list.total}
            page={list.page}
            pageSize={list.pageSize}
            onPage={setPage}
            loading={loading}
            href={salesHref}
            deal={{ show: showDeal, client: list.canSeeClients, deal: list.canSeeDeals }}
            selection={
              canTick
                ? {
                    isSelected: (id) => ticks.has(id),
                    toggle: (row) => bulk.toggle(selectedFromRow(row)),
                    page: pageTicks,
                    togglePage: (on) => bulk.setMany(rows.map(selectedFromRow), on),
                  }
                : undefined
            }
            rowMenu={rowMenu}
            cardActions={cardActions}
            onOpen={(row, field) => panel.open(row.id, field)}
            openId={panel.openId}
            addable={{ details: actions.canUpdateUnit, price: actions.canManagePrice }}
          />
          {bulk.bar}
        </div>
      )}
      {bulk.dialogs}
      {/* The unit side panel: what a row opens (2026-11-09). */}
      <UnitPanel projectId={projectId} nav={panel} ids={rows.map((row) => row.id)} types={unitTypes} canViewSales fullHref={(id) => `/projects/${projectId}/units/${id}/sales`} onChanged={reload} />
    </div>
  );
}
