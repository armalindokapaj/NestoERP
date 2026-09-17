import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { DetailGrid, RecordContextHeader } from "@/components/modules/record-header";
import { UnitActions } from "@/components/project-structure/unit-actions";
import { Badge } from "@/components/ui/badge";
import { UNIT_TYPE_CATEGORY_LABELS } from "@/config/unit-types";
import { AccessError } from "@/lib/access/guards";
import { attributesFor } from "@/lib/modules/project-structure/structure.rules";
import { getProjectStructure, getUnitDetail } from "@/lib/modules/project-structure/structure.service";
import { AREA_FIELDS, AREA_LABELS, FLOOR_LEVEL_LABELS, ORIENTATION_LABELS, POSITION_LABELS, UNIT_ATTRIBUTES } from "@/lib/modules/project-structure/structure.types";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject } from "../../project-context";
import { ProjectTabs } from "../../project-tabs";

type Params = { params: Promise<{ projectId: string; unitId: string }> };

export const metadata: Metadata = { title: "Unit" };

const dash = (value: string | number | null | undefined) => (value === null || value === undefined || value === "" ? "—" : value);
const area = (value: string | null) => (value === null ? "—" : `${Number(value).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`);

/**
 * The one page of a unit (E-05B §29, §30, §82, §102, §105, §106).
 *
 * Sales, Finance, Documents and the 3D explorer will all open this page for
 * this unit; none of them gets a page of its own. A unit is found only through
 * the project in the URL — a unit of another project, even one the reader can
 * open, is not found here.
 */
export default async function UnitPage({ params }: Params) {
  const { projectId, unitId } = await params;
  const { context, project } = await loadProject(projectId);
  const actions = projects.projectActions(context);
  if (!actions.canViewUnits) redirect("/access-denied");

  const unit = await getUnitDetail(context, unitId, project.id).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    if (error instanceof AccessError && error.code === "FORBIDDEN") redirect("/access-denied");
    throw error;
  });
  const writes = unit.capabilities.canUpdateUnit || unit.capabilities.canMoveUnit;
  const structure = writes ? await getProjectStructure(context, project.id) : null;
  const units = `/projects/${project.id}/units`;
  const attributes = attributesFor(unit.unitType.category).filter((key) => unit.attributes[key] !== undefined);

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          // Project / Building / Floor / Unit, each level clickable, the company always named (§102; E-05A §9).
          { label: "Projects", href: "/projects" },
          { label: project.company.name, href: `/projects?company=${encodeURIComponent(project.company.id)}` },
          { label: project.name, href: `/projects/${project.id}` },
          { label: unit.building.name, href: `${units}?building=${unit.building.id}` },
          { label: unit.floor.name, href: `${units}?floor=${unit.floor.id}` },
          { label: unit.unitCode },
        ]}
        title={unit.unitCode}
        subtitle={unit.unitType.name}
        actions={structure ? <UnitActions unit={unit} types={structure.unitTypes} buildings={structure.buildings} /> : null}
      />
      <ProjectTabs
        projectId={project.id}
        active="units"
        show={{
          planning: actions.canViewPlanning,
          units: actions.canViewUnits,
          contractors: actions.canViewContractors,
          engineering: actions.canViewEngineering,
          tasks: actions.canViewTasks,
          calendar: actions.canViewCalendar,
          meetings: actions.canViewMeetings,
          dailyLogs: actions.canViewDailyLogs,
          team: actions.canViewMembers,
          finance: actions.canViewFinance,
          contracts: actions.canViewContracts,
          inventory: actions.canViewInventory,
          qaqc: actions.canViewQaqc,
          hse: actions.canViewHse,
          documents: actions.canViewDocuments,
          activity: actions.canViewActivity,
        }}
      />

      <p className="flex flex-wrap items-center gap-2 text-body text-fg-muted" data-testid="unit-location">
        <span>
          {unit.building.name} · {unit.floor.name}
          {unit.name ? <span className="text-fg-subtle"> · {unit.name}</span> : null}
        </span>
        {unit.isActive ? null : <Badge>Inactive</Badge>}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="nesto-card p-5" aria-labelledby="unit-technical">
          <h2 id="unit-technical" className="text-card font-semibold text-fg">
            Technical data
          </h2>
          <DetailGrid
            className="mt-4"
            items={[
              { label: "Type", value: `${unit.unitType.name} · ${UNIT_TYPE_CATEGORY_LABELS[unit.unitType.category]}` },
              { label: "Building", value: unit.building.code ? `${unit.building.name} (${unit.building.code})` : unit.building.name },
              { label: "Floor", value: `${unit.floor.name} · ${FLOOR_LEVEL_LABELS[unit.floor.levelType]}` },
              { label: "Position", value: unit.position ? POSITION_LABELS[unit.position] : "—" },
              { label: "Orientation", value: unit.orientation ? ORIENTATION_LABELS[unit.orientation] : "—" },
              { label: "Rooms", value: dash(unit.rooms) },
              { label: "Bedrooms", value: dash(unit.bedrooms) },
              { label: "Bathrooms", value: dash(unit.bathrooms) },
              ...attributes.map((key) => {
                const value = unit.attributes[key];
                return { label: UNIT_ATTRIBUTES[key].label, value: typeof value === "boolean" ? (value ? "Yes" : "No") : dash(value) };
              }),
            ]}
          />
          {unit.description ? <p className="mt-4 whitespace-pre-line text-body text-fg">{unit.description}</p> : null}
        </section>

        <section className="nesto-card p-5" aria-labelledby="unit-areas">
          <h2 id="unit-areas" className="text-card font-semibold text-fg">
            Areas
          </h2>
          <DetailGrid className="mt-4" items={AREA_FIELDS.map((field) => ({ label: AREA_LABELS[field], value: <span className="tabular-nums">{area(unit.areas[field])}</span> }))} />
        </section>
      </div>
    </div>
  );
}
