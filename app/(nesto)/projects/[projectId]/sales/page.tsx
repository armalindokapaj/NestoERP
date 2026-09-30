import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound, redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { EMPTY_INVENTORY_FILTERS, SalesInventory, type InventoryFilters } from "@/components/sales/unit-sales/sales-inventory";
import { AccessError } from "@/lib/access/guards";
import { getProjectStructure } from "@/lib/modules/project-structure/structure.service";
import * as projects from "@/lib/modules/projects/project.service";
import { salesCapabilities } from "@/lib/modules/sales/units/unit-sales.core";
import { listSalesInventory } from "@/lib/modules/sales/units/unit-sales.inventory";
import { parseInventoryQuery } from "@/lib/modules/sales/units/unit-sales.schema";
import { loadProject, } from "../project-context";

type Params = { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("tabs.sales") };
}

function refuse(error: unknown): never {
  if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
  if (error instanceof AccessError && error.code === "FORBIDDEN") redirect("/access-denied");
  throw error;
}

/**
 * A project's Sales inventory (E-05E §13, §14, §55): the project's own units —
 * never a Sales copy — with their commercial status, price and reservation. The
 * URL carries the filters, so a shared link opens the same list.
 */
export default async function ProjectSalesPage({ params, searchParams }: Params) {
  const { projectId } = await params;
  const search = await searchParams;
  const { context, project } = await loadProject(projectId);
  const t = await getTranslations("projects");
  const actions = projects.projectActions(context);
  if (!actions.canViewUnitSales) redirect("/access-denied");

  const query = parseInventoryQuery(search);
  const [structure, inventory] = await Promise.all([getProjectStructure(context, project.id).catch(refuse), listSalesInventory(context, project.id, query).catch(refuse)]);
  const caps = salesCapabilities(context);
  const filters: InventoryFilters = {
    ...EMPTY_INVENTORY_FILTERS,
    q: query.q ?? "",
    commercialStatus: query.commercialStatus ?? "",
    buildingId: query.buildingId ?? "",
    floorId: query.floorId ?? "",
    unitTypeId: query.unitTypeId ?? "",
    orientation: query.orientation ?? "",
    position: query.position ?? "",
    bedrooms: query.bedrooms === undefined ? "" : String(query.bedrooms),
    bathrooms: query.bathrooms === undefined ? "" : String(query.bathrooms),
    areaMin: query.areaMin ?? "",
    areaMax: query.areaMax ?? "",
    priceMin: query.priceMin ?? "",
    priceMax: query.priceMax ?? "",
    pricePerSqmMin: query.pricePerSqmMin ?? "",
    pricePerSqmMax: query.pricePerSqmMax ?? "",
    sort: query.sort ?? "structure",
  };

  return (
    <div className="space-y-5">
      <RecordContextHeader title={project.name} subtitle={project.code} status={project.status} />
      {structure.totals.units === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong bg-surface-muted px-4 py-10 text-center text-table text-fg-muted" data-testid="sales-empty">
          {t("structurePages.salesNoUnits")}
        </p>
      ) : (
        <SalesInventory
          projectId={project.id}
          initial={inventory}
          initialFilters={filters}
          buildings={structure.buildings.map((building) => ({ id: building.id, name: building.name, floors: building.floors.map((floor) => ({ id: floor.id, name: floor.name })) }))}
          unitTypes={structure.unitTypes.map((type) => ({ id: type.id, name: type.name }))}
          actions={{ canReserve: caps.canReserve, canRelease: caps.canRelease }}
        />
      )}
    </div>
  );
}
