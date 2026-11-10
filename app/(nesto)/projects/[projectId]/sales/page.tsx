import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound, redirect } from "next/navigation";
import { Tags } from "@/components/icons";

import { RecordContextHeader } from "@/components/modules/record-header";
import Link from "@/components/navigation/nav-link";
import { filtersFromQuery } from "@/components/project-structure/unit-filters";
import { UnitSheetActions } from "@/components/project-structure/unit-sheet/unit-sheet-actions";
import { SalesInventory, type InventoryFilters } from "@/components/sales/unit-sales/sales-inventory";
import { Button } from "@/components/ui/button";
import { AccessError } from "@/lib/access/guards";
import { getProjectStructure } from "@/lib/modules/project-structure/structure.service";
import * as projects from "@/lib/modules/projects/project.service";
import { salesCapabilities } from "@/lib/modules/sales/units/unit-sales.core";
import { listSalesInventory } from "@/lib/modules/sales/units/unit-sales.inventory";
import { parseInventoryQuery } from "@/lib/modules/sales/units/unit-sales.schema";
import { getSheetStatus } from "@/lib/modules/unit-sheet/unit-sheet.service";
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
 *
 * Beside the price list: Export and the Google Sheet control, the Units tab's
 * own (2026-11-10) — one link per project, whichever tab linked it. Below lg
 * both are items of the page's ⋯, so the header keeps a row only for the
 * price list.
 */
export default async function ProjectSalesPage({ params, searchParams }: Params) {
  const { projectId } = await params;
  const search = await searchParams;
  const { context, project } = await loadProject(projectId);
  const t = await getTranslations("projects");
  const tSales = await getTranslations("sales");
  const actions = projects.projectActions(context);
  if (!actions.canViewUnitSales) redirect("/access-denied");

  const query = parseInventoryQuery(search);
  const [structure, inventory, sheetStatus] = await Promise.all([
    getProjectStructure(context, project.id).catch(refuse),
    listSalesInventory(context, project.id, query).catch(refuse),
    getSheetStatus(context, project.id).catch(() => null),
  ]);
  const caps = salesCapabilities(context);
  const filters: InventoryFilters = { ...filtersFromQuery(query), publication: "" };
  const prices =
    caps.canManagePrice && structure.totals.units > 0 ? (
      <Button asChild variant="secondary">
        <Link href={`/projects/${project.id}/sales/prices`} data-testid="sales-prices-link">
          <Tags aria-hidden="true" />
          {tSales("priceList.open")}
        </Link>
      </Button>
    ) : null;

  return (
    <div className="space-y-5">
      <RecordContextHeader
        nameInLayout
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={
          <>
            {prices}
            <UnitSheetActions projectId={project.id} view="sales" initialStatus={sheetStatus} exportOffered={structure.totals.units > 0} sheetOffered={structure.buildings.length > 0} />
          </>
        }
        actionsBelowLg={prices !== null}
      />
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
          unitTypes={structure.unitTypes}
          actions={{ canReserve: caps.canReserve, canRelease: caps.canRelease, canManagePrice: caps.canManagePrice, canManageStatus: caps.canManageStatus, canUpdateUnit: structure.capabilities.canUpdateUnit }}
          initialOpenUnit={typeof search.unit === "string" && search.unit ? search.unit : null}
        />
      )}
    </div>
  );
}
