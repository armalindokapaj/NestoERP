"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Building2, ChevronRight, Copy, Layers, MoreHorizontal, MoveRight, Pencil, Plus, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/ui/search-field";
import { useToast } from "@/components/ui/toast";
import {
  FLOOR_LEVEL_LABELS,
  ORIENTATION_LABELS,
  POSITION_LABELS,
  UNIT_ORIENTATIONS,
  UNIT_POSITIONS,
  UNIT_SORT_LABELS,
  UNIT_SORTS,
  type BuildingNodeDTO,
  type FloorNodeDTO,
  type ProjectStructureDTO,
  type UnitDTO,
  type UnitListDTO,
  type UnitSort,
} from "@/lib/modules/project-structure/structure.types";
import { cn } from "@/lib/utils/cn";
import { BulkFloorsDialog, BulkUnitsDialog, CopyFloorDialog } from "./bulk-dialogs";
import { BuildingDialog, FloorDialog, MoveFloorDialog, MoveUnitDialog } from "./structure-dialogs";
import { areaRule, failureMessage, numberText, plural, structureApi } from "./structure-ui";
import { parseOptionalDecimal } from "@/lib/forms/decimal";
import { UnitDialog } from "./unit-dialog";
import { EMPTY_FILTERS, type UnitFilters } from "./unit-filters";
import { UNIT_PUBLICATION_STATUS_LABELS, UNIT_PUBLICATION_STATUSES } from "@/lib/modules/project-structure/unit-publishing.types";
import { UnitTable, type UnitRowActions } from "./unit-table";

/**
 * A project's structure (E-05B §31-§34, §46-§50, §88-§94, §101, §103, §104, §107-§109).
 *
 * Project → Building → Floor → Unit, always in view: a tree of buildings and
 * floors with their counts beside the units of whatever is chosen — the whole
 * project, one building or one floor. The tree never carries units; they load
 * a page at a time for the choice, filtered and sorted by the server. On a
 * phone the tree becomes two dropdowns (§33). The URL carries the choice and
 * the filters, so a unit page's breadcrumb lands back on its floor.
 */

type Selection = { buildingId: string | null; floorId: string | null };

type DialogState =
  | { kind: "building"; building?: BuildingNodeDTO }
  | { kind: "floor"; building: BuildingNodeDTO; floor?: FloorNodeDTO }
  | { kind: "bulkFloors"; buildingId: string }
  | { kind: "moveFloor"; floor: FloorNodeDTO }
  | { kind: "unit"; floor: { id: string; name: string; buildingName: string }; unit?: UnitDTO }
  | { kind: "bulkUnits"; floor: FloorNodeDTO; buildingName: string }
  | { kind: "copy"; floor: FloorNodeDTO }
  | { kind: "moveUnit"; unit: UnitDTO }
  | { kind: "delete"; target: { type: "building"; building: BuildingNodeDTO } | { type: "floor"; floor: FloorNodeDTO } | { type: "unit"; unit: UnitDTO } }
  | null;

const FILTER_KEYS = ["unitTypeId", "orientation", "position", "bedrooms", "bathrooms", "internalAreaMin", "internalAreaMax", "saleableAreaMin", "saleableAreaMax"] as const;

function queryString(selection: Selection, filters: UnitFilters, page: number): string {
  const params = new URLSearchParams();
  if (selection.buildingId) params.set("buildingId", selection.buildingId);
  if (selection.floorId) params.set("floorId", selection.floorId);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  for (const key of FILTER_KEYS) if (filters[key]) params.set(key, filters[key]);
  // One control, two parameters: a publication status, or published units with unpublished changes (E-05D §28).
  if (filters.publication === "CHANGES") params.set("unpublishedChanges", "true");
  else if (filters.publication) params.set("publicationStatus", filters.publication);
  if (filters.sort !== "structure") params.set("sort", filters.sort);
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
  url.search = params.toString();
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

export function StructureWorkspace({ initial, initialSelection, initialFilters, initialPage, initialUnits }: { initial: ProjectStructureDTO; initialSelection: Selection; initialFilters: UnitFilters; initialPage: number; initialUnits: UnitListDTO | null }) {
  const toast = useToast();
  const [structure, setStructure] = React.useState(initial);
  const [selection, setSelection] = React.useState<Selection>(initialSelection);
  const [filters, setFilters] = React.useState<UnitFilters>(initialFilters);
  const [search, setSearch] = React.useState(initialFilters.q);
  const [page, setPage] = React.useState(initialPage);
  const [units, setUnits] = React.useState<UnitListDTO | null>(initialUnits);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [filtersOpen, setFiltersOpen] = React.useState(FILTER_KEYS.some((key) => initialFilters[key]));
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(initial.buildings.length <= 3 ? initial.buildings.map((building) => building.id) : initialSelection.buildingId ? [initialSelection.buildingId] : []));
  const [treeFilter, setTreeFilter] = React.useState("");
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [pending, setPending] = React.useState(false);
  const firstLoad = React.useRef(true);

  const caps = structure.capabilities;
  const projectId = structure.project.id;
  const building = structure.buildings.find((candidate) => candidate.id === selection.buildingId) ?? null;
  const floor = building?.floors.find((candidate) => candidate.id === selection.floorId) ?? null;
  const activeFilters = FILTER_KEYS.filter((key) => filters[key]).length + (filters.q.trim() ? 1 : 0) + (filters.publication ? 1 : 0);

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
      toast({ title: failureMessage(error, "Could not load project structure."), tone: "danger" });
    }
  }, [projectId, toast]);

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
        if (!response.ok || !json?.data) throw new Error(json?.error?.message ?? "Could not load units.");
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
        setLoadError(error instanceof Error ? error.message : "Could not load units.");
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

  function choose(next: Selection) {
    setSelection(next);
    setPage(1);
    if (next.buildingId) setExpanded((current) => new Set(current).add(next.buildingId!));
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
    const [url, label] = target.type === "building" ? [`/api/project-buildings/${target.building.id}`, target.building.name] : target.type === "floor" ? [`/api/project-floors/${target.floor.id}`, target.floor.name] : [`/api/project-units/${target.unit.id}`, target.unit.unitCode];
    setPending(true);
    try {
      await structureApi(url, { method: "DELETE" });
      toast({ title: `${label} deleted.` });
      setDialog(null);
      if (target.type === "building" && selection.buildingId === target.building.id) choose({ buildingId: null, floorId: null });
      if (target.type === "floor" && selection.floorId === target.floor.id) choose({ buildingId: target.floor.buildingId, floorId: null });
      await reloadAll();
    } catch (error) {
      setDialog(null);
      toast({ title: failureMessage(error, `${label} could not be deleted.`), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  const unitActions: UnitRowActions = {
    canUpdate: caps.canUpdateUnit,
    canMove: caps.canMoveUnit,
    canDelete: caps.canDeleteUnit,
    canReorder: caps.canManageStructure && Boolean(floor) && filters.sort === "structure" && activeFilters === 0 && (units?.total ?? 0) <= (units?.pageSize ?? 0),
    onEdit: (unit) => setDialog({ kind: "unit", floor: { id: unit.floor.id, name: unit.floor.name, buildingName: unit.building.name }, unit }),
    onMove: (unit) => setDialog({ kind: "moveUnit", unit }),
    onDelete: (unit) => setDialog({ kind: "delete", target: { type: "unit", unit } }),
    onReorder: (unit, offset) => {
      if (!floor || !units) return;
      const ids = reorder(units.items, unit.id, offset);
      if (ids) void send(`/api/project-floors/${floor.id}/units/reorder`, { ids }, "The order could not be saved.");
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
              Edit building
            </DropdownMenuItem>
          ) : null}
          {caps.canCreateFloor ? (
            <>
              <DropdownMenuItem onSelect={() => setDialog({ kind: "floor", building: target })}>
                <Plus aria-hidden="true" />
                Add floor
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog({ kind: "bulkFloors", buildingId: target.id })}>
                <Layers aria-hidden="true" />
                Create floors by range
              </DropdownMenuItem>
            </>
          ) : null}
          {caps.canManageStructure ? (
            <>
              <DropdownMenuItem disabled={index <= 0} onSelect={() => { const ids = reorder(structure.buildings, target.id, -1); if (ids) void send(`/api/projects/${projectId}/buildings/reorder`, { ids }, "The order could not be saved."); }}>
                <ArrowUp aria-hidden="true" />
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index >= structure.buildings.length - 1} onSelect={() => { const ids = reorder(structure.buildings, target.id, 1); if (ids) void send(`/api/projects/${projectId}/buildings/reorder`, { ids }, "The order could not be saved."); }}>
                <ArrowDown aria-hidden="true" />
                Move down
              </DropdownMenuItem>
            </>
          ) : null}
          {caps.canDeleteBuilding ? (
            <DropdownMenuItem className="text-danger-strong" onSelect={() => setDialog({ kind: "delete", target: { type: "building", building: target } })}>
              <Trash2 aria-hidden="true" />
              Delete building
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
          <Button variant="secondary" size="icon" aria-label={`More actions for ${target.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {caps.canCreateUnit ? (
            <DropdownMenuItem onSelect={() => setDialog({ kind: "copy", floor: target })}>
              <Copy aria-hidden="true" />
              Copy units from another floor
            </DropdownMenuItem>
          ) : null}
          {caps.canUpdateFloor ? (
            <DropdownMenuItem onSelect={() => setDialog({ kind: "floor", building: owner, floor: target })}>
              <Pencil aria-hidden="true" />
              Edit floor
            </DropdownMenuItem>
          ) : null}
          {caps.canManageStructure ? (
            <>
              <DropdownMenuItem onSelect={() => setDialog({ kind: "moveFloor", floor: target })}>
                <MoveRight aria-hidden="true" />
                Move to another building
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index <= 0} onSelect={() => { const ids = reorder(owner.floors, target.id, -1); if (ids) void send(`/api/project-buildings/${owner.id}/floors/reorder`, { ids }, "The order could not be saved."); }}>
                <ArrowUp aria-hidden="true" />
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index >= owner.floors.length - 1} onSelect={() => { const ids = reorder(owner.floors, target.id, 1); if (ids) void send(`/api/project-buildings/${owner.id}/floors/reorder`, { ids }, "The order could not be saved."); }}>
                <ArrowDown aria-hidden="true" />
                Move down
              </DropdownMenuItem>
            </>
          ) : null}
          {caps.canDeleteFloor ? (
            <DropdownMenuItem className="text-danger-strong" onSelect={() => setDialog({ kind: "delete", target: { type: "floor", floor: target } })}>
              <Trash2 aria-hidden="true" />
              Delete floor
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  /* Header for the choice ------------------------------------------------------ */

  const title = floor && building ? `${floor.name} — ${building.name}` : building ? building.name : structure.buildings.length ? "All units" : "Units";
  const meta = floor
    ? [plural(floor.unitCount, "unit"), FLOOR_LEVEL_LABELS[floor.levelType], floor.elevation !== null ? `+${floor.elevation} m` : null, floor.isActive ? null : "Inactive"].filter(Boolean).join(" · ")
    : building
      ? [plural(building.floorCount, "floor"), plural(building.unitCount, "unit"), building.isActive ? null : "Inactive"].filter(Boolean).join(" · ")
      : [plural(structure.totals.buildings, "building"), plural(structure.totals.floors, "floor"), plural(structure.totals.units, "unit")].join(" · ");

  const headerActions = floor && building ? (
    <>
      {caps.canCreateUnit ? (
        <>
          <Button onClick={() => setDialog({ kind: "unit", floor: { id: floor.id, name: floor.name, buildingName: building.name } })}>
            <Plus aria-hidden="true" />
            Add unit
          </Button>
          <Button variant="secondary" onClick={() => setDialog({ kind: "bulkUnits", floor, buildingName: building.name })}>
            Bulk add
          </Button>
        </>
      ) : null}
      {floorMenu(building, floor)}
    </>
  ) : building ? (
    <>
      {caps.canCreateFloor ? (
        <>
          <Button onClick={() => setDialog({ kind: "floor", building })}>
            <Plus aria-hidden="true" />
            Add floor
          </Button>
          <Button variant="secondary" onClick={() => setDialog({ kind: "bulkFloors", buildingId: building.id })}>
            Create floors
          </Button>
        </>
      ) : null}
      {buildingMenu(building, `More actions for ${building.name}`)}
    </>
  ) : caps.canCreateBuilding && structure.buildings.length ? (
    <Button onClick={() => setDialog({ kind: "building" })}>
      <Plus aria-hidden="true" />
      Add building
    </Button>
  ) : null;

  /* Body ----------------------------------------------------------------------- */

  let body: React.ReactNode;
  if (!structure.buildings.length) {
    body = (
      <Empty icon={<Building2 />} title="Set up project structure" description="Start by adding the first building. A single-building project has one too." testId="structure-empty">
        {caps.canCreateBuilding ? (
          <Button onClick={() => setDialog({ kind: "building" })}>
            <Plus aria-hidden="true" />
            Add building
          </Button>
        ) : null}
      </Empty>
    );
  } else if (building && !floor && !building.floors.length) {
    body = (
      <Empty icon={<Layers />} title="No floors yet." description={`Add floors to ${building.name}.`} testId="building-empty">
        {caps.canCreateFloor ? (
          <>
            <Button onClick={() => setDialog({ kind: "floor", building })}>
              <Plus aria-hidden="true" />
              Add floor
            </Button>
            <Button variant="secondary" onClick={() => setDialog({ kind: "bulkFloors", buildingId: building.id })}>
              Create floors
            </Button>
          </>
        ) : null}
      </Empty>
    );
  } else if (floor && building && floor.unitCount === 0 && activeFilters === 0) {
    body = (
      <Empty icon={<Layers />} title="No units on this floor." description="Add them one at a time, by code range, or copy another floor's layout." testId="floor-empty">
        {caps.canCreateUnit ? (
          <>
            <Button onClick={() => setDialog({ kind: "unit", floor: { id: floor.id, name: floor.name, buildingName: building.name } })}>
              <Plus aria-hidden="true" />
              Add unit
            </Button>
            <Button variant="secondary" onClick={() => setDialog({ kind: "bulkUnits", floor, buildingName: building.name })}>
              Bulk add units
            </Button>
            <Button variant="ghost" onClick={() => setDialog({ kind: "copy", floor })}>
              <Copy aria-hidden="true" />
              Copy a floor
            </Button>
          </>
        ) : null}
      </Empty>
    );
  } else {
    body = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField className="w-full sm:w-auto sm:min-w-0 sm:max-w-xs sm:flex-1" placeholder="Search code, name or type" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search units" />
          <Button variant="secondary" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen}>
            <SlidersHorizontal aria-hidden="true" />
            Filters{FILTER_KEYS.some((key) => filters[key]) ? ` (${FILTER_KEYS.filter((key) => filters[key]).length})` : ""}
          </Button>
          <select aria-label="Sort units" className={cn(selectClass, "w-auto")} value={filters.sort} onChange={(event) => setFilter({ sort: event.target.value as UnitSort })}>
            {UNIT_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {UNIT_SORT_LABELS[sort]}
              </option>
            ))}
          </select>
          {activeFilters ? (
            <Button variant="ghost" onClick={clearFilters}>
              <RotateCcw aria-hidden="true" />
              Clear filters
            </Button>
          ) : null}
        </div>

        {filtersOpen ? (
          <div className="grid grid-cols-2 gap-3 rounded-md border border-line bg-surface-muted p-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="unit-filters">
            <FilterSelect label="Type" value={filters.unitTypeId} onChange={(unitTypeId) => setFilter({ unitTypeId })} options={structure.unitTypes.map((type) => ({ value: type.id, label: type.name }))} />
            <FilterSelect label="Publication" value={filters.publication} onChange={(publication) => setFilter({ publication })} options={[...UNIT_PUBLICATION_STATUSES.map((value) => ({ value, label: UNIT_PUBLICATION_STATUS_LABELS[value] })), { value: "CHANGES", label: "Unpublished changes" }]} />
            <FilterSelect label="Orientation" value={filters.orientation} onChange={(orientation) => setFilter({ orientation })} options={UNIT_ORIENTATIONS.map((value) => ({ value, label: ORIENTATION_LABELS[value] }))} />
            <FilterSelect label="Position" value={filters.position} onChange={(position) => setFilter({ position })} options={UNIT_POSITIONS.map((value) => ({ value, label: POSITION_LABELS[value] }))} />
            <FilterSelect label="Bedrooms" value={filters.bedrooms} onChange={(bedrooms) => setFilter({ bedrooms })} options={[0, 1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value) }))} />
            <FilterSelect label="Bathrooms" value={filters.bathrooms} onChange={(bathrooms) => setFilter({ bathrooms })} options={[0, 1, 2, 3, 4].map((value) => ({ value: String(value), label: String(value) }))} />
            <RangeFilter label="Internal area (m²)" min={filters.internalAreaMin} max={filters.internalAreaMax} onChange={(internalAreaMin, internalAreaMax) => setFilter({ internalAreaMin, internalAreaMax })} />
            <RangeFilter label="Saleable area (m²)" min={filters.saleableAreaMin} max={filters.saleableAreaMax} onChange={(saleableAreaMin, saleableAreaMax) => setFilter({ saleableAreaMin, saleableAreaMax })} />
          </div>
        ) : null}

        {loadError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong" role="alert">
            <span>{loadError}</span>
            <Button variant="secondary" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
              Retry
            </Button>
          </div>
        ) : units && units.items.length ? (
          <>
            {activeFilters ? <p className="text-table text-fg-muted">{plural(units.total, "result")}</p> : null}
            <UnitTable projectId={projectId} list={units} showLocation={!floor} actions={unitActions} onPage={setPage} loading={loading} />
          </>
        ) : units ? (
          <p className="rounded-md border border-dashed border-line-strong bg-surface-muted px-4 py-10 text-center text-table text-fg-muted" data-testid="units-none">
            {activeFilters ? "No units match these filters." : "No units here yet."}
          </p>
        ) : (
          <p className="px-4 py-10 text-center text-table text-fg-muted">Loading units…</p>
        )}
      </div>
    );
  }

  /* Layout --------------------------------------------------------------------- */

  return (
    <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      {structure.buildings.length ? (
        <>
          {/* Desktop: the tree (§31, §32). */}
          <aside className="hidden lg:block" aria-label="Buildings and floors">
            <div className="nesto-card sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto p-2">
              <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
                <h2 className="text-meta font-semibold uppercase tracking-[0.08em] text-fg-subtle">Structure</h2>
                {caps.canCreateBuilding ? (
                  <Button variant="ghost" size="icon-sm" aria-label="Add building" onClick={() => setDialog({ kind: "building" })}>
                    <Plus />
                  </Button>
                ) : null}
              </div>
              {structure.buildings.length > 8 ? (
                <div className="px-1 pb-2">
                  <Input aria-label="Find a building" placeholder="Find a building" value={treeFilter} onChange={(event) => setTreeFilter(event.target.value)} className="h-8" />
                </div>
              ) : null}
              <button
                type="button"
                className={cn("flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-table", !selection.buildingId ? "bg-hover font-medium text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}
                aria-current={!selection.buildingId ? "true" : undefined}
                onClick={() => choose({ buildingId: null, floorId: null })}
              >
                <span>All units</span>
                <span className="tabular-nums text-fg-subtle">{structure.totals.units}</span>
              </button>
              <ul className="mt-1 space-y-0.5" data-testid="structure-tree">
                {visibleBuildings.map((candidate) => {
                  const open = expanded.has(candidate.id);
                  return (
                    <li key={candidate.id} data-testid="tree-building" data-building-name={candidate.name}>
                      <div className={cn("group flex items-center rounded-md", selection.buildingId === candidate.id && !selection.floorId ? "bg-hover" : "hover:bg-hover")}>
                        <button
                          type="button"
                          className="flex size-7 shrink-0 items-center justify-center rounded text-fg-subtle hover:text-fg touch:size-11"
                          aria-label={open ? `Collapse ${candidate.name}` : `Expand ${candidate.name}`}
                          aria-expanded={open}
                          onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(candidate.id)) next.delete(candidate.id); else next.add(candidate.id); return next; })}
                        >
                          <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden="true" />
                        </button>
                        <button type="button" className="min-w-0 flex-1 py-1.5 text-left" aria-current={selection.buildingId === candidate.id && !selection.floorId ? "true" : undefined} onClick={() => choose({ buildingId: candidate.id, floorId: null })}>
                          <span className={cn("block truncate text-table font-medium", candidate.isActive ? "text-fg" : "text-fg-muted")}>{candidate.name}</span>
                          <span className="block text-meta text-fg-subtle">
                            {plural(candidate.floorCount, "floor")} · {plural(candidate.unitCount, "unit")}
                          </span>
                        </button>
                        {/* Hover reveals the menu under a mouse; a finger has no hover, so on touch it is always shown (AUD-04 §3, MW-19). */}
                        <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 touch:opacity-100">{buildingMenu(candidate, `Actions for ${candidate.name}`)}</span>
                      </div>
                      {open ? (
                        <ul className="mb-1 ml-7 border-l border-line pl-1">
                          {candidate.floors.map((level) => (
                            <li key={level.id}>
                              <button
                                type="button"
                                className={cn("flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-table touch:min-h-11", selection.floorId === level.id ? "bg-accent-soft font-medium text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}
                                aria-current={selection.floorId === level.id ? "true" : undefined}
                                onClick={() => choose({ buildingId: candidate.id, floorId: level.id })}
                                data-testid="tree-floor"
                              >
                                <span className={cn("truncate", !level.isActive && "line-through decoration-fg-subtle/60")}>{level.name}</span>
                                <span className="tabular-nums text-fg-subtle">{level.unitCount}</span>
                              </button>
                            </li>
                          ))}
                          {!candidate.floors.length ? <li className="px-2 py-1 text-meta text-fg-subtle">No floors yet</li> : null}
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
              <label htmlFor="structure-building" className="text-meta font-medium text-fg-muted">
                Building
              </label>
              <select id="structure-building" className={selectClass} value={selection.buildingId ?? ""} onChange={(event) => choose({ buildingId: event.target.value || null, floorId: null })}>
                <option value="">All buildings</option>
                {structure.buildings.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="structure-floor" className="text-meta font-medium text-fg-muted">
                Floor
              </label>
              <select id="structure-floor" className={selectClass} value={selection.floorId ?? ""} disabled={!building} onChange={(event) => choose({ buildingId: selection.buildingId, floorId: event.target.value || null })}>
                <option value="">All floors</option>
                {building?.floors.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.name} · {level.unitCount}
                  </option>
                ))}
              </select>
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
                {meta}
              </p>
            ) : null}
          </div>
          {headerActions ? <div className="flex flex-wrap items-center gap-2">{headerActions}</div> : null}
        </div>
        {body}
      </section>

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
          onCreated={(buildingId) => {
            void reloadAll();
            choose({ buildingId, floorId: null });
          }}
        />
      ) : null}
      {dialog?.kind === "moveFloor" ? <MoveFloorDialog open onOpenChange={(open) => !open && setDialog(null)} floor={dialog.floor} buildings={structure.buildings} onMoved={() => { void reloadAll(); choose({ buildingId: null, floorId: null }); toast({ title: `${dialog.floor.name} moved. Its units went with it.` }); }} /> : null}
      {dialog?.kind === "unit" ? <UnitDialog open onOpenChange={(open) => !open && setDialog(null)} floor={dialog.floor} unit={dialog.unit} types={structure.unitTypes} onSaved={() => void reloadAll()} /> : null}
      {dialog?.kind === "bulkUnits" ? <BulkUnitsDialog open onOpenChange={(open) => !open && setDialog(null)} floor={dialog.floor} buildingName={dialog.buildingName} types={structure.unitTypes} onCreated={() => void reloadAll()} /> : null}
      {dialog?.kind === "copy" ? <CopyFloorDialog open onOpenChange={(open) => !open && setDialog(null)} projectId={projectId} floor={dialog.floor} buildings={structure.buildings} onCreated={() => void reloadAll()} /> : null}
      {dialog?.kind === "moveUnit" ? (
        <MoveUnitDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          unit={{ id: dialog.unit.id, unitCode: dialog.unit.unitCode, version: dialog.unit.version, floorId: dialog.unit.floor.id, buildingId: dialog.unit.building.id }}
          buildings={structure.buildings}
          onMoved={() => {
            toast({ title: `${dialog.unit.unitCode} moved. Its code and page are unchanged.` });
            void reloadAll();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog?.kind === "delete" ? `Delete ${dialog.target.type === "building" ? dialog.target.building.name : dialog.target.type === "floor" ? dialog.target.floor.name : dialog.target.unit.unitCode}?` : "Delete?"}
        description={
          dialog?.kind === "delete" && dialog.target.type === "building"
            ? "Only an empty building can be deleted: remove or move its floors first. This cannot be undone."
            : dialog?.kind === "delete" && dialog.target.type === "floor"
              ? "Only an empty floor can be deleted: move or remove its units first. This cannot be undone."
              : "The unit and its page are removed. Deactivate it instead to keep it on record. This cannot be undone."
        }
        pending={pending}
        onConfirm={() => void confirmDelete()}
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

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  const id = `filter-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-meta font-medium text-fg-muted">
        {label}
      </label>
      <select id={id} className={cn(selectClass, "h-9")} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function RangeFilter({ label, min, max, onChange }: { label: string; min: string; max: string; onChange: (min: string, max: string) => void }) {
  const [low, setLow] = React.useState(min);
  const [high, setHigh] = React.useState(max);
  React.useEffect(() => {
    setLow(min);
    setHigh(max);
  }, [min, max]);
  const apply = () => {
    // Read by the shared locale rule (AUD-09 §4, FV-06): "12,5" is 12.5; an ambiguous "1,234" is not applied.
    const valid = (value: string) => {
      const parsed = parseOptionalDecimal(value, areaRule(label));
      return parsed.ok ? (parsed.value ?? "") : "";
    };
    if (valid(low) !== min || valid(high) !== max) onChange(valid(low), valid(high));
  };
  return (
    <fieldset className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
      <legend className="mb-1 text-meta font-medium text-fg-muted">{label}</legend>
      <div className="flex items-center gap-1.5">
        <Input aria-label={`${label} from`} placeholder="Min" inputMode="decimal" className="h-9" value={low} onChange={(event) => setLow(numberText(event.target.value))} onBlur={apply} onKeyDown={(event) => event.key === "Enter" && apply()} />
        <span className="text-fg-subtle">–</span>
        <Input aria-label={`${label} to`} placeholder="Max" inputMode="decimal" className="h-9" value={high} onChange={(event) => setHigh(numberText(event.target.value))} onBlur={apply} onKeyDown={(event) => event.key === "Enter" && apply()} />
      </div>
    </fieldset>
  );
}
