import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { StructureWorkspace } from "@/components/project-structure/structure-workspace";
import { EMPTY_FILTERS, type UnitFilters } from "@/components/project-structure/unit-filters";
import { AccessError } from "@/lib/access/guards";
import { parseUnitListQuery } from "@/lib/modules/project-structure/structure.schema";
import { getProjectStructure, listProjectUnits } from "@/lib/modules/project-structure/structure.service";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: "Units" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || null;

function refuse(error: unknown): never {
  if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
  if (error instanceof AccessError && error.code === "FORBIDDEN") redirect("/access-denied");
  throw error;
}

/**
 * A project's buildings, floors and units (E-05B §31-§34, §129).
 *
 * `?building=` or `?floor=` chooses where the page opens — which is how a unit
 * page's breadcrumb comes back to its floor. A choice that is not part of this
 * project is ignored rather than trusted (§117).
 */
export default async function ProjectUnitsPage({ params, searchParams }: Params) {
  const { projectId } = await params;
  const search = await searchParams;
  const { context, project } = await loadProject(projectId);
  const actions = projects.projectActions(context);
  if (!actions.canViewUnits) redirect("/access-denied");

  const structure = await getProjectStructure(context, project.id).catch(refuse);

  const floorId = one(search.floor);
  const owner = floorId ? structure.buildings.find((building) => building.floors.some((floor) => floor.id === floorId)) : undefined;
  const buildingId = owner?.id ?? structure.buildings.find((building) => building.id === one(search.building))?.id ?? null;
  const selection = { buildingId, floorId: owner ? floorId : null };

  const query = parseUnitListQuery(search);
  const filters: UnitFilters = {
    ...EMPTY_FILTERS,
    q: query.q ?? "",
    unitTypeId: query.unitTypeId ?? "",
    orientation: query.orientation ?? "",
    position: query.position ?? "",
    bedrooms: query.bedrooms === undefined ? "" : String(query.bedrooms),
    bathrooms: query.bathrooms === undefined ? "" : String(query.bathrooms),
    internalAreaMin: query.internalAreaMin ?? "",
    internalAreaMax: query.internalAreaMax ?? "",
    saleableAreaMin: query.saleableAreaMin ?? "",
    saleableAreaMax: query.saleableAreaMax ?? "",
    publication: query.unpublishedChanges ? "CHANGES" : (query.publicationStatus ?? ""),
    sort: query.sort ?? "structure",
  };
  const units = structure.buildings.length
    ? await listProjectUnits(context, project.id, { ...query, buildingId: selection.buildingId ?? undefined, floorId: selection.floorId ?? undefined }).catch(refuse)
    : null;

  return (
    <div className="space-y-5">
      <RecordContextHeader breadcrumbs={projectBreadcrumbs(project, "Units")} title={project.name} subtitle={project.code} status={project.status} />
      <ProjectTabs
        projectId={project.id}
        active="units"
        show={{
          planning: actions.canViewPlanning,
          units: actions.canViewUnits,
          sales: actions.canViewUnitSales,
          contractors: actions.canViewContractors,
          engineering: actions.canViewEngineering,
          tasks: actions.canViewTasks,
          calendar: actions.canViewCalendar,
          meetings: actions.canViewMeetings,
          dailyLogs: actions.canViewDailyLogs,
          workforce: actions.canViewWorkforce,
          team: actions.canViewMembers,
          finance: actions.canViewFinance,
          unitFinance: actions.canViewUnitFinance,
          contracts: actions.canViewContracts,
          inventory: actions.canViewInventory,
          qaqc: actions.canViewQaqc,
          hse: actions.canViewHse,
          documents: actions.canViewDocuments,
          activity: actions.canViewActivity,
        }}
      />
      <StructureWorkspace initial={structure} initialSelection={selection} initialFilters={filters} initialPage={units?.page ?? 1} initialUnits={units} />
    </div>
  );
}
