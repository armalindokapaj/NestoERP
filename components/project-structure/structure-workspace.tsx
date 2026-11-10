"use client";

import * as React from "react";
import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import { floorName } from "@/lib/i18n/stock-names";
import { ArrowDown, ArrowUp, Building2, ChevronRight, Copy, Layers, MoreHorizontal, MoveRight, Pencil, Plus, Tags, Trash2 } from "@/components/icons";
import Link from "@/components/navigation/nav-link";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { type BuildingNodeDTO, type FloorNodeDTO, type ProjectStructureDTO, type UnitDTO, type UnitListDTO } from "@/lib/modules/project-structure/structure.types";
import { pageState, refreshUnits } from "@/lib/modules/project-structure/unit-bulk.rules";
import { cn } from "@/lib/utils/cn";
import { BulkFloorsDialog, BulkUnitsDialog, CopyFloorDialog } from "./bulk-dialogs";
import { BuildingDialog, FloorDialog, MoveFloorDialog, MoveUnitDialog } from "./structure-dialogs";
import { AddUnitsDialog, splitFloors } from "./add-units-dialog";
import { failureMessage, structureApi } from "./structure-ui";
import { UnitDialog } from "./unit-dialog";
import { activeCount, EMPTY_FILTERS, filterParams, type UnitFilters } from "./unit-filters";
import { UnitActionSheet, UnitRowMenu, type UnitRowActions } from "./unit-table";
import { canChangeTogether, fetchSelection, SelectionHelp, useUnitBulk } from "./unit-list/unit-bulk";
import { rowFromUnit, selectedFromRow, type UnitListRow } from "./unit-list/unit-list-row";
import { UnitListTable } from "./unit-list/unit-list-table";
import { UnitListToolbar } from "./unit-list/unit-list-toolbar";
import { UnitPanel } from "./unit-panel/unit-panel";
import { keepOpenUnit, useUnitPanelNav } from "./unit-panel/use-unit-panel";
import { UNITS_CHANGED_EVENT } from "./unit-sheet/sheet-client";
import { UnitSheetActions } from "./unit-sheet/unit-sheet-actions";
import { FormSelect } from "@/components/ui/form-select";
import type { SheetStatusDTO } from "@/lib/modules/unit-sheet/unit-sheet.types";

/**
 * A project's structure (E-05B §31-§34, §46-§50, §88-§94, §101, §103, §104, §107-§109).
 *
 * Project → Building → Floor → Unit, always in view: a tree of buildings and
 * floors with their counts beside the units of whatever is chosen — the whole
 * project, one building or one floor. The tree never carries units; they load
 * a page at a time for the choice, filtered and sorted by the server. On a
 * phone the tree becomes two dropdowns (§33). The URL carries the choice and
 * the filters, so a unit page's breadcrumb lands back on its floor.
 *
 * The tree lists a building's floors that have units; the empty ones fold
 * behind one "N empty floors" row, which opens on a click and by itself when
 * an empty floor is chosen (2026-11-09). The counts are said once: the tree
 * carries them from lg, so the heading's line keeps only the floor's details
 * there. "Add units" is the main button whenever there is a floor to add to;
 * it asks for the building and floor itself. "Add building" is the tree's +.
 *
 * The unit list is the table the Sales tab shares, with tick boxes for
 * somebody who may change units together (2026-11-09): Edit details, Set
 * price, Put on sale, Move, Archive. A line above it says how many units in
 * view still miss an area, bedrooms or a price, and Fill in ticks exactly
 * those and opens Edit details — or Set price when only prices are missing.
 * The Prices page's "skipped, no area" note opens this tab with `tick=no-area`
 * and its floor, which ticks the units it skipped once, on arrival.
 *
 * A row opens the unit in the side panel beside the list (2026-11-09), named
 * in the address as `?unit=`; an empty cell's "Add" opens it on that field.
 *
 * Export and the Google Sheet control sit between Prices and Add units
 * (2026-11-10, unit-sheet/unit-sheet-actions.tsx), as on the Sales tab; a
 * confirmed sync reads the list and the tree again.
 */

type Selection = { buildingId: string | null; floorId: string | null };

type DialogState =
  | { kind: "building"; building?: BuildingNodeDTO }
  | { kind: "floor"; building: BuildingNodeDTO; floor?: FloorNodeDTO }
  | { kind: "bulkFloors"; buildingId: string }
  | { kind: "moveFloor"; floor: FloorNodeDTO }
  | { kind: "addUnits" }
  | { kind: "unit"; floor: { id: string; name: string; buildingName: string; buildingCode: string | null }; unit?: UnitDTO }
  | { kind: "bulkUnits"; floor: FloorNodeDTO; buildingName: string; buildingCode: string | null }
  | { kind: "copy"; floor: FloorNodeDTO }
  | { kind: "moveUnit"; unit: UnitDTO }
  | { kind: "archive" | "restore"; unit: UnitDTO }
  | { kind: "delete"; target: { type: "building"; building: BuildingNodeDTO } | { type: "floor"; floor: FloorNodeDTO } | { type: "unit"; unit: UnitDTO } }
  | null;

function queryString(selection: Selection, filters: UnitFilters, page: number): string {
  const params = filterParams(filters, "units");
  if (selection.buildingId) params.set("buildingId", selection.buildingId);
  if (selection.floorId) params.set("floorId", selection.floorId);
  if (page > 1) params.set("page", String(page));
  return params.toString();
}

function writeUrl(selection: Selection, filters: UnitFilters, page: number) {
  const url = new URL(window.location.href);
  const params = new URLSearchParams(queryString(selection, filters, page));
  // The page's own URL names the choice `building` and `floor`.
  const building = params.get("buildingId");
  const floor = params.get("floorId");
  params.delete("buildingId");
  params.delete("floorId");
  if (floor) params.set("floor", floor);
  else if (building) params.set("building", building);
  // The open unit's panel stays open as the list's own query changes.
  url.search = keepOpenUnit(params).toString();
  window.history.replaceState(window.history.state, "", url.toString());
}

function reorder<T extends { id: string }>(items: T[], id: string, offset: -1 | 1): string[] | null {
  const ids = items.map((item) => item.id);
  const index = ids.indexOf(id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= ids.length) return null;
  [ids[index], ids[target]] = [ids[target]!, ids[index]!];
  return ids;
}

export function StructureWorkspace({
  initial,
  initialSelection,
  initialFilters,
  initialPage,
  initialUnits,
  initialTick = null,
  initialOpenUnit = null,
  canViewSales = false,
  sheetStatus = null,
}: {
  initial: ProjectStructureDTO;
  initialSelection: Selection;
  initialFilters: UnitFilters;
  initialPage: number;
  initialUnits: UnitListDTO | null;
  /** Ticks these units once on arrival: `no-area`, the units the Prices page skipped for having no area. */
  initialTick?: "no-area" | null;
  /** The unit the address opens in the side panel (`?unit=`). */
  initialOpenUnit?: string | null;
  /** Whether the person may see the units' sales: the panel's price and sale status. */
  canViewSales?: boolean;
  /** The project's Google Sheet link and what the reader may do with it, as the page read them. */
  sheetStatus?: SheetStatusDTO | null;
}) {
  const toast = useToast();
  const t = useTranslations("projects");
  const locale = useLocale();
  const [structure, setStructure] = React.useState(initial);
  const [selection, setSelection] = React.useState<Selection>(initialSelection);
  const [filters, setFilters] = React.useState<UnitFilters>(initialFilters);
  const [search, setSearch] = React.useState(initialFilters.q);
  const [page, setPage] = React.useState(initialPage);
  const [units, setUnits] = React.useState<UnitListDTO | null>(initialUnits);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(initial.buildings.length <= 3 ? initial.buildings.map((building) => building.id) : initialSelection.buildingId ? [initialSelection.buildingId] : []));
  const [treeFilter, setTreeFilter] = React.useState("");
  /** Which buildings show their empty floors; one opens by itself when an empty floor of it is chosen. */
  const [emptyOpen, setEmptyOpen] = React.useState<Record<string, boolean>>(() => {
    const owner = initial.buildings.find((candidate) => candidate.floors.some((level) => level.id === initialSelection.floorId && level.unitCount === 0));
    return owner ? { [owner.id]: true } : {};
  });
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [pending, setPending] = React.useState(false);
  const firstLoad = React.useRef(true);
  const panel = useUnitPanelNav(initialOpenUnit);

  const caps = structure.capabilities;
  const projectId = structure.project.id;
  const building = structure.buildings.find((candidate) => candidate.id === selection.buildingId) ?? null;
  const floor = building?.floors.find((candidate) => candidate.id === selection.floorId) ?? null;
  const activeFilters = activeCount(filters, "units");

  // Search waits for typing to pause (E-05A's 300 ms), everything else applies at once.
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => (current.q === search ? current : { ...current, q: search }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const refreshStructure = React.useCallback(async () => {
    try {
      setStructure(await structureApi<ProjectStructureDTO>(`/api/projects/${projectId}/structure`));
    } catch (error) {
      toast({ title: failureMessage(error, t("workspace.loadStructureFailed")), tone: "danger" });
    }
  }, [projectId, toast, t]);

  React.useEffect(() => {
    writeUrl(selection, filters, page);
    if (firstLoad.current && initialUnits) {
      firstLoad.current = false;
      return;
    }
    firstLoad.current = false;
    if (!structure.buildings.length) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    fetch(`/api/projects/${projectId}/units?${queryString(selection, filters, page)}`, { signal: controller.signal })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as { data?: UnitListDTO; error?: { message?: string } } | null;
        if (!response.ok || !json?.data) throw new Error(json?.error?.message ?? t("workspace.loadUnitsFailed"));
        const list = json.data;
        // A page left past the end (a delete, a move, a narrower filter) steps
        // once to the last real page; its URL follows (AUD-08 §4, DT-05). The
        // target is always in range, so this cannot loop.
        const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize));
        if (list.items.length === 0 && list.total > 0 && list.page > lastPage) {
          setPage(lastPage);
          return;
        }
        setUnits(list);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : t("workspace.loadUnitsFailed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, filters, page, reloadKey, projectId, structure.buildings.length]);

  const reloadAll = React.useCallback(async () => {
    await refreshStructure();
    setReloadKey((key) => key + 1);
  }, [refreshStructure]);

  // A confirmed Google Sheet sync changed units, or added some: the tree and the list read them again.
  React.useEffect(() => {
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId === projectId) void reloadAll();
    };
    window.addEventListener(UNITS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(UNITS_CHANGED_EVENT, onChanged);
  }, [projectId, reloadAll]);

  /* Ticking units and changing them together (2026-11-09) ----------------------- */

  const bulkCaps = { details: caps.canUpdateUnit, price: caps.canManagePrice, status: caps.canManageSaleStatus, move: caps.canMoveUnit, archive: caps.canArchiveUnit };
  const canTick = canChangeTogether(bulkCaps);
  // What the list shows, its page and sort aside: when it changes, the ticks go.
  const shownKey = React.useMemo(() => {
    const params = filterParams({ ...filters, sort: "structure" }, "units");
    return `${selection.buildingId ?? ""}|${selection.floorId ?? ""}|${params.toString()}`;
  }, [filters, selection]);
  const bulk = useUnitBulk({
    projectId,
    caps: bulkCaps,
    resetKey: shownKey,
    types: structure.unitTypes,
    buildings: structure.buildings.map((candidate) => ({ id: candidate.id, name: candidate.name, floors: candidate.floors.map((level) => ({ id: level.id, name: level.name })) })),
    onChanged: reloadAll,
  });
  const { setSelection: setTicks, setMany: tickMany, start: startBulk } = bulk;
  const rows = React.useMemo(() => (units ? units.items.map(rowFromUnit) : []), [units]);
  // A list read again brings each ticked unit's current versions with it.
  React.useEffect(() => {
    setTicks((current) => refreshUnits(current, rows.map(selectedFromRow)));
  }, [rows, setTicks]);

  /** Every unit of the current choice, optionally narrowed by the filters or to what it is missing. */
  const selectionUrl = React.useCallback(
    (options: { withFilters: boolean; missing?: string; floorId?: string | null }) => {
      const params = options.withFilters ? filterParams(filters, "units") : new URLSearchParams();
      const floorId = options.floorId === undefined ? selection.floorId : options.floorId;
      if (floorId) params.set("floorId", floorId);
      else if (selection.buildingId) params.set("buildingId", selection.buildingId);
      if (options.missing) params.set("missing", options.missing);
      params.set("select", "all");
      return `/api/projects/${projectId}/units?${params.toString()}`;
    },
    [filters, projectId, selection],
  );

  // The Prices page's "skipped, no area" note lands here once, with its floor chosen.
  const tickedOnArrival = React.useRef(false);
  React.useEffect(() => {
    if (tickedOnArrival.current || initialTick !== "no-area") return;
    tickedOnArrival.current = true;
    void fetchSelection(selectionUrl({ withFilters: false, missing: "area" }))
      .then((found) => {
        if (!found.units.length) return;
        tickMany(found.units, true);
        if (caps.canUpdateUnit) startBulk("details", found.units);
      })
      .catch((error: unknown) => toast({ title: failureMessage(error, t("unitList.selectFailed")), tone: "danger" }));
  }, [caps.canUpdateUnit, initialTick, selectionUrl, startBulk, t, tickMany, toast]);

  function choose(next: Selection) {
    setSelection(next);
    setPage(1);
    if (next.buildingId) setExpanded((current) => new Set(current).add(next.buildingId!));
    // An empty floor lives behind its building's "empty floors" row: choosing one opens it.
    const owner = next.buildingId ? structure.buildings.find((candidate) => candidate.id === next.buildingId) : undefined;
    if (owner && owner.floors.some((level) => level.id === next.floorId && level.unitCount === 0)) setEmptyOpen((current) => ({ ...current, [owner.id]: true }));
  }

  /** After units are added somewhere the list is not showing, show that floor. */
  function showFloor(target: { buildingId: string; floorId: string }) {
    const shown = selection.floorId ? selection.floorId === target.floorId : selection.buildingId ? selection.buildingId === target.buildingId : true;
    if (!shown) choose(target);
  }

  async function changeArchive() {
    if (dialog?.kind !== "archive" && dialog?.kind !== "restore") return;
    const { unit, kind } = dialog;
    // The unit page's own request (publishing-actions.tsx); a refusal is a toast, as a failed delete is.
    await send(`/api/project-units/${unit.id}/${kind}`, { expectedVersion: unit.version }, t("publishing.failed", { label: kind === "archive" ? t("publishing.archiving") : t("publishing.restoring") }), kind === "archive" ? t("publishing.archived", { code: unit.label }) : t("publishing.restored", { code: unit.label }));
    setDialog(null);
  }

  function setFilter(patch: Partial<UnitFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  function clearFilters() {
    setSearch("");
    setFilters({ ...EMPTY_FILTERS, sort: filters.sort });
    setPage(1);
  }

  async function send(url: string, body: unknown, fallback: string, done?: string) {
    setPending(true);
    try {
      await structureApi(url, { body });
      if (done) toast({ title: done });
      await reloadAll();
      return true;
    } catch (error) {
      toast({ title: failureMessage(error, fallback), tone: "danger" });
      return false;
    } finally {
      setPending(false);
    }
  }

  async function confirmDelete() {
    if (dialog?.kind !== "delete") return;
    const target = dialog.target;
    const [url, label] = target.type === "building" ? [`/api/project-buildings/${target.building.id}`, target.building.name] : target.type === "floor" ? [`/api/project-floors/${target.floor.id}`, floorName(target.floor.name, locale)] : [`/api/project-units/${target.unit.id}`, target.unit.label];
    setPending(true);
    try {
      await structureApi(url, { method: "DELETE" });
      toast({ title: t("workspace.deleted", { label }) });
      setDialog(null);
      if (target.type === "building" && selection.buildingId === target.building.id) choose({ buildingId: null, floorId: null });
      if (target.type === "floor" && selection.floorId === target.floor.id) choose({ buildingId: target.floor.buildingId, floorId: null });
      await reloadAll();
    } catch (error) {
      setDialog(null);
      toast({ title: failureMessage(error, t("workspace.deleteFailed", { label })), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  const unitActions: UnitRowActions = {
    canUpdate: caps.canUpdateUnit,
    canMove: caps.canMoveUnit,
    canDelete: caps.canDeleteUnit,
    canArchive: caps.canArchiveUnit,
    canReorder: caps.canManageStructure && Boolean(floor) && filters.sort === "structure" && activeFilters === 0 && (units?.total ?? 0) <= (units?.pageSize ?? 0),
    onEdit: (unit) => setDialog({ kind: "unit", floor: { id: unit.floor.id, name: unit.floor.name, buildingName: unit.building.name, buildingCode: unit.building.code }, unit }),
    onMove: (unit) => setDialog({ kind: "moveUnit", unit }),
    onDelete: (unit) => setDialog({ kind: "delete", target: { type: "unit", unit } }),
    onArchive: (unit) => setDialog({ kind: "archive", unit }),
    onRestore: (unit) => setDialog({ kind: "restore", unit }),
    onReorder: (unit, offset) => {
      if (!floor || !units) return;
      const ids = reorder(units.items, unit.id, offset);
      if (ids) void send(`/api/project-floors/${floor.id}/units/reorder`, { ids }, t("workspace.orderFailed"));
    },
  };

  const visibleBuildings = treeFilter.trim() ? structure.buildings.filter((candidate) => `${candidate.name} ${candidate.code ?? ""}`.toLowerCase().includes(treeFilter.trim().toLowerCase())) : structure.buildings;

  /* Menus ------------------------------------------------------------------- */

  const buildingMenu = (target: BuildingNodeDTO, label: string) => {
    const index = structure.buildings.findIndex((candidate) => candidate.id === target.id);
    const items = [caps.canUpdateBuilding, caps.canCreateFloor, caps.canManageStructure, caps.canDeleteBuilding].some(Boolean);
    if (!items) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={label}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {caps.canUpdateBuilding ? (
            <DropdownMenuItem onSelect={() => setDialog({ kind: "building", building: target })}>
              <Pencil aria-hidden="true" />
              {t("workspace.editBuilding")}
            </DropdownMenuItem>
          ) : null}
          {caps.canCreateFloor ? (
            <>
              <DropdownMenuItem onSelect={() => setDialog({ kind: "floor", building: target })}>
                <Plus aria-hidden="true" />
                {t("workspace.addFloor")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog({ kind: "bulkFloors", buildingId: target.id })}>
                <Layers aria-hidden="true" />
                {t("workspace.floorsByRange")}
              </DropdownMenuItem>
            </>
          ) : null}
          {caps.canManageStructure ? (
            <>
              <DropdownMenuItem disabled={index <= 0} onSelect={() => { const ids = reorder(structure.buildings, target.id, -1); if (ids) void send(`/api/projects/${projectId}/buildings/reorder`, { ids }, t("workspace.orderFailed")); }}>
                <ArrowUp aria-hidden="true" />
                {t("workspace.moveUp")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index >= structure.buildings.length - 1} onSelect={() => { const ids = reorder(structure.buildings, target.id, 1); if (ids) void send(`/api/projects/${projectId}/buildings/reorder`, { ids }, t("workspace.orderFailed")); }}>
                <ArrowDown aria-hidden="true" />
                {t("workspace.moveDown")}
              </DropdownMenuItem>
            </>
          ) : null}
          {caps.canDeleteBuilding ? (
            <DropdownMenuItem className="text-danger-strong" onSelect={() => setDialog({ kind: "delete", target: { type: "building", building: target } })}>
              <Trash2 aria-hidden="true" />
              {t("workspace.deleteBuilding")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const floorMenu = (owner: BuildingNodeDTO, target: FloorNodeDTO) => {
    const index = owner.floors.findIndex((candidate) => candidate.id === target.id);
    const items = [caps.canUpdateFloor, caps.canCreateUnit, caps.canManageStructure, caps.canDeleteFloor].some(Boolean);
    if (!items) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="icon" aria-label={t("workspace.moreActionsFor", { name: floorName(target.name, locale) })}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {caps.canCreateUnit ? (
            <DropdownMenuItem onSelect={() => setDialog({ kind: "copy", floor: target })}>
              <Copy aria-hidden="true" />
              {t("workspace.copyUnits")}
            </DropdownMenuItem>
          ) : null}
          {caps.canUpdateFloor ? (
            <DropdownMenuItem onSelect={() => setDialog({ kind: "floor", building: owner, floor: target })}>
              <Pencil aria-hidden="true" />
              {t("workspace.editFloor")}
            </DropdownMenuItem>
          ) : null}
          {caps.canManageStructure ? (
            <>
              <DropdownMenuItem onSelect={() => setDialog({ kind: "moveFloor", floor: target })}>
                <MoveRight aria-hidden="true" />
                {t("workspace.moveToBuilding")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index <= 0} onSelect={() => { const ids = reorder(owner.floors, target.id, -1); if (ids) void send(`/api/project-buildings/${owner.id}/floors/reorder`, { ids }, t("workspace.orderFailed")); }}>
                <ArrowUp aria-hidden="true" />
                {t("workspace.moveUp")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index >= owner.floors.length - 1} onSelect={() => { const ids = reorder(owner.floors, target.id, 1); if (ids) void send(`/api/project-buildings/${owner.id}/floors/reorder`, { ids }, t("workspace.orderFailed")); }}>
                <ArrowDown aria-hidden="true" />
                {t("workspace.moveDown")}
              </DropdownMenuItem>
            </>
          ) : null}
          {caps.canDeleteFloor ? (
            <DropdownMenuItem className="text-danger-strong" onSelect={() => setDialog({ kind: "delete", target: { type: "floor", floor: target } })}>
              <Trash2 aria-hidden="true" />
              {t("workspace.deleteFloor")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  /* Header for the choice ------------------------------------------------------ */

  const title = floor && building ? `${floorName(floor.name, locale)} — ${building.name}` : building ? building.name : structure.buildings.length ? t("workspace.allUnits") : t("workspace.units");
  // The counts are said once: from lg the tree carries them, so this line keeps only what the tree does not say.
  const counts = floor
    ? t("counts.units", { count: floor.unitCount })
    : building
      ? [t("counts.floors", { count: building.floorCount }), t("counts.units", { count: building.unitCount })].join(" · ")
      : [t("counts.buildings", { count: structure.totals.buildings }), t("counts.floors", { count: structure.totals.floors }), t("counts.units", { count: structure.totals.units })].join(" · ");
  const details = floor
    ? [t(`floorLevel.${floor.levelType}`), floor.elevation !== null ? `+${floor.elevation} m` : null, floor.isActive ? null : t("workspace.inactive")].filter(Boolean).join(" · ")
    : building && !building.isActive
      ? t("workspace.inactive")
      : "";

  // "Add units" is the main button whenever there is a floor to add to (2026-11-09); without one, adding a floor is.
  const canAddUnits = caps.canCreateUnit && structure.buildings.some((candidate) => candidate.floors.length > 0);
  const floorTarget = building ?? (structure.buildings.length === 1 ? structure.buildings[0]! : null);
  const addFloorFirst = !canAddUnits && caps.canCreateFloor && floorTarget !== null && (Boolean(building) || !floorTarget.floors.length);
  const prices =
    caps.canManagePrice && structure.totals.units > 0 ? (
      <Button asChild variant="secondary">
        <Link href={`/projects/${projectId}/sales/prices`} data-testid="units-prices-link">
          <Tags aria-hidden="true" />
          {t("workspace.prices")}
        </Link>
      </Button>
    ) : null;
  // Export and the Google Sheet (2026-11-10): Export once there are units, the sheet once there is a building for its rows.
  const exportOffered = structure.totals.units > 0;
  const sheetOffered = structure.buildings.length > 0;
  const headerActions = (
    <>
      {prices}
      <UnitSheetActions projectId={projectId} view="units" initialStatus={sheetStatus} exportOffered={exportOffered} sheetOffered={sheetOffered} />
      {canAddUnits && building && !floor && caps.canCreateFloor ? (
        <Button variant="secondary" onClick={() => setDialog({ kind: "floor", building })}>
          <Plus aria-hidden="true" />
          {t("workspace.addFloor")}
        </Button>
      ) : null}
      {canAddUnits ? (
        <Button onClick={() => setDialog({ kind: "addUnits" })} data-testid="add-units">
          <Plus aria-hidden="true" />
          {t("workspace.addUnits")}
        </Button>
      ) : addFloorFirst && floorTarget ? (
        <Button onClick={() => setDialog({ kind: "floor", building: floorTarget })}>
          <Plus aria-hidden="true" />
          {t("workspace.addFloor")}
        </Button>
      ) : null}
      {floor && building ? floorMenu(building, floor) : building ? buildingMenu(building, t("workspace.moreActionsFor", { name: building.name })) : null}
    </>
  );
  const hasHeaderActions = Boolean(prices) || exportOffered || sheetOffered || canAddUnits || addFloorFirst || Boolean(building);

  /* Body ----------------------------------------------------------------------- */

  let body: React.ReactNode;
  if (!structure.buildings.length) {
    body = (
      <Empty icon={<Building2 />} title={t("workspace.setupTitle")} description={t("workspace.setupBody")} testId="structure-empty">
        {caps.canCreateBuilding ? (
          <Button onClick={() => setDialog({ kind: "building" })}>
            <Plus aria-hidden="true" />
            {t("workspace.addBuilding")}
          </Button>
        ) : null}
      </Empty>
    );
  } else if (building && !floor && !building.floors.length) {
    body = (
      <Empty icon={<Layers />} title={t("workspace.noFloorsTitle")} description={t("workspace.noFloorsBody", { name: building.name })} testId="building-empty">
        {caps.canCreateFloor ? (
          <>
            <Button onClick={() => setDialog({ kind: "floor", building })}>
              <Plus aria-hidden="true" />
              {t("workspace.addFloor")}
            </Button>
            <Button variant="secondary" onClick={() => setDialog({ kind: "bulkFloors", buildingId: building.id })}>
              {t("workspace.createFloors")}
            </Button>
          </>
        ) : null}
      </Empty>
    );
  } else if (floor && building && floor.unitCount === 0 && activeFilters === 0) {
    body = (
      <Empty icon={<Layers />} title={t("workspace.noUnitsTitle")} description={t("workspace.noUnitsBody")} testId="floor-empty">
        {caps.canCreateUnit ? (
          <>
            <Button onClick={() => setDialog({ kind: "unit", floor: { id: floor.id, name: floor.name, buildingName: building.name, buildingCode: building.code } })}>
              <Plus aria-hidden="true" />
              {t("workspace.addUnit")}
            </Button>
            <Button variant="secondary" onClick={() => setDialog({ kind: "bulkUnits", floor, buildingName: building.name, buildingCode: building.code })}>
              {t("workspace.bulkAddUnits")}
            </Button>
            <Button variant="ghost" onClick={() => setDialog({ kind: "copy", floor })}>
              <Copy aria-hidden="true" />
              {t("workspace.copyFloor")}
            </Button>
          </>
        ) : null}
      </Empty>
    );
  } else {
    const ticks = bulk.selection;
    const page = pageState(ticks, rows.map((row) => row.id));
    const missingCount = caps.canUpdateUnit && caps.canManagePrice ? units?.missing.either ?? 0 : caps.canUpdateUnit ? units?.missing.details ?? 0 : caps.canManagePrice ? units?.missing.price ?? 0 : 0;
    const missingKind = caps.canUpdateUnit && caps.canManagePrice ? "either" : caps.canUpdateUnit ? "details" : "price";
    body = (
      <div className="space-y-3">
        <UnitListToolbar
          kind="units"
          filters={filters}
          search={search}
          onSearch={setSearch}
          onChange={setFilter}
          onClear={clearFilters}
          placeholder={t("workspace.searchPlaceholder")}
          unitTypes={structure.unitTypes}
        />

        {loadError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong" role="alert">
            <span>{loadError}</span>
            <Button variant="secondary" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
              {t("workspace.retry")}
            </Button>
          </div>
        ) : units && units.items.length ? (
          <div className="space-y-3">
            {activeFilters ? <p className="text-table text-fg-muted">{t("counts.results", { count: units.total })}</p> : null}
            {canTick ? (
              <SelectionHelp
                ticked={ticks.size}
                page={page}
                total={units.total}
                limit={500}
                onSelectAll={async () => {
                  const found = await fetchSelection(selectionUrl({ withFilters: true }));
                  bulk.setMany(found.units, true);
                }}
                // The whole floor, whatever the filters and pages show: offered while some of it is not ticked and the page alone would not tick it.
                floor={
                  floor && (floor.unitCount > units.items.length || activeFilters > 0) && [...ticks.values()].filter((unit) => unit.floorId === floor.id).length < floor.unitCount
                    ? {
                        count: floor.unitCount,
                        onSelect: async () => {
                          const found = await fetchSelection(selectionUrl({ withFilters: false, floorId: floor.id }));
                          bulk.setMany(found.units, true);
                        },
                      }
                    : null
                }
                missing={
                  missingCount > 0
                    ? {
                        text: t(`unitList.missing.${missingKind}`, { count: missingCount }),
                        // Ticks exactly the units missing something and opens Edit details — the areas a price per m² needs come first —
                        // or Set price when only prices are missing. The ticks stay, so Set price can follow on the same units.
                        onFill: async () => {
                          const found = await fetchSelection(selectionUrl({ withFilters: false, missing: missingKind }));
                          if (!found.units.length) return;
                          bulk.clear();
                          bulk.setMany(found.units, true);
                          const needsDetails = caps.canUpdateUnit && (missingKind === "details" || (units.missing.details ?? 0) > 0);
                          bulk.start(needsDetails ? "details" : "price", found.units);
                        },
                      }
                    : null
                }
              />
            ) : null}
            <UnitListTable
              kind="units"
              rows={rows}
              total={units.total}
              page={units.page}
              pageSize={units.pageSize}
              onPage={setPage}
              loading={loading}
              href={(row) => `/projects/${projectId}/units/${row.id}`}
              onOpen={(row, field) => panel.open(row.id, field)}
              openId={panel.openId}
              addable={{ details: caps.canUpdateUnit, price: caps.canManagePrice }}
              selection={
                canTick
                  ? {
                      isSelected: (id) => ticks.has(id),
                      toggle: (row: UnitListRow) => bulk.toggle(selectedFromRow(row)),
                      page,
                      togglePage: (on) => bulk.setMany(rows.map(selectedFromRow), on),
                    }
                  : undefined
              }
              rowMenu={(row, index) => {
                const unit = units.items.find((item) => item.id === row.id);
                return unit ? <UnitRowMenu unit={unit} href={`/projects/${projectId}/units/${unit.id}`} index={index} count={units.items.length} actions={unitActions} /> : null;
              }}
              cardActions={(row, index) => {
                const unit = units.items.find((item) => item.id === row.id);
                return unit ? <UnitActionSheet unit={unit} href={`/projects/${projectId}/units/${unit.id}`} index={index} count={units.items.length} actions={unitActions} /> : null;
              }}
            />
            {bulk.bar}
          </div>
        ) : units ? (
          <p className="rounded-md border border-dashed border-line-strong bg-surface-muted px-4 py-10 text-center text-table text-fg-muted" data-testid="units-none">
            {activeFilters ? t("workspace.noMatch") : t("workspace.noneHere")}
          </p>
        ) : (
          <p className="px-4 py-10 text-center text-table text-fg-muted">{t("workspace.loading")}</p>
        )}
      </div>
    );
  }

  /* Layout --------------------------------------------------------------------- */

  // A narrow tree (13rem, 14rem from xl) so the unit table beside it fits without scrolling sideways, even at 1024px with long prices and floor names. Long names truncate.
  return (
    <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)]">
      {structure.buildings.length ? (
        <>
          {/* Desktop: the tree (§31, §32). */}
          <aside className="hidden lg:block" aria-label={t("workspace.treeLabel")}>
            <div className="nesto-card sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto p-2">
              <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
                <h2 className="text-meta font-semibold uppercase tracking-[0.08em] text-fg-subtle">{t("workspace.structure")}</h2>
                {caps.canCreateBuilding ? (
                  <Button variant="ghost" size="icon-sm" aria-label={t("workspace.addBuilding")} onClick={() => setDialog({ kind: "building" })}>
                    <Plus />
                  </Button>
                ) : null}
              </div>
              {structure.buildings.length > 8 ? (
                <div className="px-1 pb-2">
                  <Input aria-label={t("workspace.findBuilding")} placeholder={t("workspace.findBuilding")} value={treeFilter} onChange={(event) => setTreeFilter(event.target.value)} className="h-8" />
                </div>
              ) : null}
              <button
                type="button"
                className={cn("flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-table", !selection.buildingId ? "bg-hover font-medium text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}
                aria-current={!selection.buildingId ? "true" : undefined}
                onClick={() => choose({ buildingId: null, floorId: null })}
              >
                <span>{t("workspace.allUnits")}</span>
                <span className="tabular-nums text-fg-subtle">{structure.totals.units}</span>
              </button>
              <ul className="mt-1 space-y-0.5" data-testid="structure-tree">
                {visibleBuildings.map((candidate) => {
                  const open = expanded.has(candidate.id);
                  const { withUnits, empty } = splitFloors(candidate);
                  const emptyShown = emptyOpen[candidate.id] ?? false;
                  const floorRow = (level: FloorNodeDTO) => (
                    <li key={level.id}>
                      <button
                        type="button"
                        className={cn("flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-table touch:min-h-11", selection.floorId === level.id ? "bg-accent-soft font-medium text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}
                        aria-current={selection.floorId === level.id ? "true" : undefined}
                        onClick={() => choose({ buildingId: candidate.id, floorId: level.id })}
                        data-testid="tree-floor"
                      >
                        <span className={cn("truncate", !level.isActive && "line-through decoration-fg-subtle/60")}>{floorName(level.name, locale)}</span>
                        <span className="tabular-nums text-fg-subtle">{level.unitCount}</span>
                      </button>
                    </li>
                  );
                  return (
                    <li key={candidate.id} data-testid="tree-building" data-building-name={candidate.name}>
                      <div className={cn("group flex items-center rounded-md", selection.buildingId === candidate.id && !selection.floorId ? "bg-hover" : "hover:bg-hover")}>
                        <button
                          type="button"
                          className="flex size-7 shrink-0 items-center justify-center rounded text-fg-subtle hover:text-fg touch:size-11"
                          aria-label={open ? t("workspace.collapse", { name: candidate.name }) : t("workspace.expand", { name: candidate.name })}
                          aria-expanded={open}
                          onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(candidate.id)) next.delete(candidate.id); else next.add(candidate.id); return next; })}
                        >
                          <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden="true" />
                        </button>
                        {/* The building's own count, as its floors show theirs; the floor count is the heading's (§31). */}
                        <button type="button" className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1.5 pr-1 text-left" aria-current={selection.buildingId === candidate.id && !selection.floorId ? "true" : undefined} onClick={() => choose({ buildingId: candidate.id, floorId: null })}>
                          <span className={cn("block truncate text-table font-medium", candidate.isActive ? "text-fg" : "text-fg-muted")}>{candidate.name}</span>
                          <span className="text-table tabular-nums text-fg-subtle" data-testid="tree-building-count">{candidate.unitCount}</span>
                        </button>
                        {/* Hover reveals the menu under a mouse; a finger has no hover, so on touch it is always shown (AUD-04 §3, MW-19). */}
                        <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 touch:opacity-100">{buildingMenu(candidate, t("workspace.actionsFor", { name: candidate.name }))}</span>
                      </div>
                      {open ? (
                        <ul className="mb-1 ml-7 border-l border-line pl-1">
                          {withUnits.map(floorRow)}
                          {empty.length ? (
                            <li>
                              <button
                                type="button"
                                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-table text-fg-subtle hover:bg-hover hover:text-fg touch:min-h-11"
                                aria-expanded={emptyShown}
                                onClick={() => setEmptyOpen((current) => ({ ...current, [candidate.id]: !emptyShown }))}
                                data-testid="tree-empty-floors"
                              >
                                <span className="truncate">{t("workspace.emptyFloors", { count: empty.length })}</span>
                                <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", emptyShown && "rotate-90")} aria-hidden="true" />
                              </button>
                              {emptyShown ? <ul className="ml-2">{empty.map(floorRow)}</ul> : null}
                            </li>
                          ) : null}
                          {!candidate.floors.length ? <li className="px-2 py-1 text-meta text-fg-subtle">{t("workspace.noFloorsShort")}</li> : null}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>

          {/* Phone and tablet: building and floor dropdowns (§33, §103, §104). */}
          <div className="grid grid-cols-2 gap-2 lg:hidden">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="structure-building" className="text-meta font-medium text-fg-muted">
                  {t("workspace.building")}
                </label>
                {/* The tree's + for adding a building, where the tree is not drawn. */}
                {caps.canCreateBuilding ? (
                  <Button variant="ghost" size="icon-sm" className="-my-1" aria-label={t("workspace.addBuilding")} onClick={() => setDialog({ kind: "building" })}>
                    <Plus />
                  </Button>
                ) : null}
              </div>
              <FormSelect id="structure-building" className={selectClass} value={selection.buildingId ?? ""} onChange={(event) => choose({ buildingId: event.target.value || null, floorId: null })}>
                <option value="">{t("workspace.allBuildings")}</option>
                {structure.buildings.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </FormSelect>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="structure-floor" className="text-meta font-medium text-fg-muted">
                {t("workspace.floor")}
              </label>
              <FormSelect id="structure-floor" className={selectClass} value={selection.floorId ?? ""} disabled={!building} onChange={(event) => choose({ buildingId: selection.buildingId, floorId: event.target.value || null })}>
                <option value="">{t("workspace.allFloors")}</option>
                {/* Floors with units first, the empty ones in their own group, as the tree folds them. */}
                {building
                  ? splitFloors(building).withUnits.map((level) => (
                      <option key={level.id} value={level.id}>
                        {floorName(level.name, locale)} · {level.unitCount}
                      </option>
                    ))
                  : null}
                {building && splitFloors(building).empty.length ? (
                  <optgroup label={t("workspace.emptyFloorsGroup")}>
                    {splitFloors(building).empty.map((level) => (
                      <option key={level.id} value={level.id}>
                        {floorName(level.name, locale)}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </FormSelect>
            </div>
          </div>
        </>
      ) : null}

      <section className={cn("min-w-0 space-y-4", !structure.buildings.length && "lg:col-span-2")} aria-labelledby="structure-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="structure-heading" className="text-section font-semibold text-fg" data-testid="structure-heading">
              {title}
            </h2>
            {structure.buildings.length ? (
              <p className="text-table text-fg-muted" data-testid="structure-meta">
                <span className="lg:hidden">{counts}</span>
                {details ? (
                  <>
                    <span className="lg:hidden"> · </span>
                    {details}
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          {hasHeaderActions ? <div className="flex flex-wrap items-center gap-2">{headerActions}</div> : null}
        </div>
        {body}
      </section>

      {/* The unit side panel: what a row opens (2026-11-09). */}
      <UnitPanel projectId={projectId} nav={panel} ids={rows.map((row) => row.id)} types={structure.unitTypes} canViewSales={canViewSales} fullHref={(id) => `/projects/${projectId}/units/${id}`} onChanged={() => void reloadAll()} />

      {/* Dialogs ---------------------------------------------------------------- */}
      {dialog?.kind === "building" ? (
        <BuildingDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          projectId={projectId}
          building={dialog.building}
          onSaved={(id) => {
            void reloadAll();
            if (!dialog.building) choose({ buildingId: id, floorId: null });
          }}
        />
      ) : null}
      {dialog?.kind === "floor" ? (
        <FloorDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          building={dialog.building}
          floor={dialog.floor}
          onSaved={(id) => {
            void reloadAll();
            if (!dialog.floor) choose({ buildingId: dialog.building.id, floorId: id });
          }}
        />
      ) : null}
      {dialog?.kind === "bulkFloors" ? (
        <BulkFloorsDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          buildings={structure.buildings}
          initialBuildingId={dialog.buildingId}
          canUpdateFloors={caps.canUpdateFloor}
          onCreated={(buildingId) => {
            void reloadAll();
            choose({ buildingId, floorId: null });
          }}
        />
      ) : null}
      {dialog?.kind === "moveFloor" ? <MoveFloorDialog open onOpenChange={(open) => !open && setDialog(null)} floor={dialog.floor} buildings={structure.buildings} onMoved={() => { void reloadAll(); choose({ buildingId: null, floorId: null }); toast({ title: t("workspace.floorMoved", { name: floorName(dialog.floor.name, locale) }) }); }} /> : null}
      {dialog?.kind === "addUnits" ? (
        <AddUnitsDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          buildings={structure.buildings}
          selection={selection}
          onChoose={({ building: target, floor: level, mode }) =>
            setDialog(mode === "one" ? { kind: "unit", floor: { id: level.id, name: level.name, buildingName: target.name, buildingCode: target.code } } : { kind: "bulkUnits", floor: level, buildingName: target.name, buildingCode: target.code })
          }
        />
      ) : null}
      {dialog?.kind === "unit" ? (
        <UnitDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          floor={dialog.floor}
          unit={dialog.unit}
          types={structure.unitTypes}
          canManagePrice={caps.canManagePrice}
          canManageSaleStatus={caps.canManageSaleStatus}
          onSaved={() => {
            void reloadAll();
            const owner = structure.buildings.find((candidate) => candidate.floors.some((level) => level.id === dialog.floor.id));
            if (!dialog.unit && owner) showFloor({ buildingId: owner.id, floorId: dialog.floor.id });
          }}
        />
      ) : null}
      {dialog?.kind === "bulkUnits" ? (
        <BulkUnitsDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          floor={dialog.floor}
          buildingName={dialog.buildingName}
          buildingCode={dialog.buildingCode}
          types={structure.unitTypes}
          onCreated={() => {
            void reloadAll();
            showFloor({ buildingId: dialog.floor.buildingId, floorId: dialog.floor.id });
          }}
        />
      ) : null}
      {dialog?.kind === "copy" ? <CopyFloorDialog open onOpenChange={(open) => !open && setDialog(null)} projectId={projectId} floor={dialog.floor} buildings={structure.buildings} onCreated={() => void reloadAll()} /> : null}
      {dialog?.kind === "moveUnit" ? (
        <MoveUnitDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          unit={{ id: dialog.unit.id, label: dialog.unit.label, version: dialog.unit.version, floorId: dialog.unit.floor.id, buildingId: dialog.unit.building.id }}
          buildings={structure.buildings}
          onMoved={() => {
            toast({ title: t("workspace.unitMoved", { code: dialog.unit.label }) });
            void reloadAll();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog?.kind === "delete" ? t("workspace.deleteTitle", { name: dialog.target.type === "building" ? dialog.target.building.name : dialog.target.type === "floor" ? floorName(dialog.target.floor.name, locale) : dialog.target.unit.label }) : t("workspace.deleteFallback")}
        description={
          dialog?.kind === "delete" && dialog.target.type === "building"
            ? t("workspace.deleteBuildingBody")
            : dialog?.kind === "delete" && dialog.target.type === "floor"
              ? t("workspace.deleteFloorBody")
              : t("workspace.deleteUnitBody")
        }
        pending={pending}
        onConfirm={() => void confirmDelete()}
      />
      {bulk.dialogs}
      {/* Archive and Restore from the row menu: the unit page's confirmation, word for word (E-05D §32). */}
      <ConfirmDialog
        open={dialog?.kind === "archive" || dialog?.kind === "restore"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog?.kind === "archive" ? t("publishing.archiveTitle", { code: dialog.unit.label }) : dialog?.kind === "restore" ? t("publishing.restoreTitle", { code: dialog.unit.label }) : t("publishing.archive")}
        description={dialog?.kind === "restore" ? t("publishing.restoreBody") : t("publishing.archiveBody")}
        confirmLabel={dialog?.kind === "restore" ? t("publishing.restore") : t("publishing.archive")}
        destructive={dialog?.kind !== "restore"}
        pending={pending}
        onConfirm={() => void changeArchive()}
      />
    </div>
  );
}

function Empty({ icon, title, description, children, testId }: { icon: React.ReactNode; title: string; description: string; children?: React.ReactNode; testId: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface-muted px-6 py-14 text-center" data-testid={testId}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-full border border-line bg-surface text-fg-subtle [&_svg]:size-5">{icon}</div>
      <p className="text-card font-semibold text-fg">{title}</p>
      <p className="mt-1 max-w-sm text-table text-fg-muted">{description}</p>
      {children ? <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}
