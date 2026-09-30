import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound, redirect } from "next/navigation";

import { EMPTY_FINANCE_FILTERS, FinanceInventory, type FinanceFilters } from "@/components/finance/unit-finance/finance-inventory";
import { FinanceViews } from "@/components/finance/unit-finance/finance-views";
import { RecordContextHeader } from "@/components/modules/record-header";
import { AccessError } from "@/lib/access/guards";
import { listFinanceInventory } from "@/lib/modules/finance/units/unit-finance.inventory";
import { parseFinanceInventoryQuery } from "@/lib/modules/finance/units/unit-finance.schema";
import { getProjectStructure } from "@/lib/modules/project-structure/structure.service";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, } from "../../project-context";

type Params = { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("structurePages.unitFinance") };
}

function refuse(error: unknown): never {
  if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
  if (error instanceof AccessError && error.code === "FORBIDDEN") redirect("/access-denied");
  throw error;
}

/**
 * A project's units as Finance collects them (E-05F §45-§48, §92): the project's
 * own units with their contract's value, what is paid, outstanding and overdue,
 * and the next payment — never a Finance copy of a unit. Under the project's
 * Finance tab, beside its budget and cost view.
 */
export default async function ProjectUnitFinancePage({ params, searchParams }: Params) {
  const { projectId } = await params;
  const search = await searchParams;
  const { context, project } = await loadProject(projectId);
  const t = await getTranslations("projects");
  const actions = projects.projectActions(context);
  if (!actions.canViewUnitFinance) redirect("/access-denied");

  const query = parseFinanceInventoryQuery(search);
  const [structure, inventory] = await Promise.all([getProjectStructure(context, project.id).catch(refuse), listFinanceInventory(context, project.id, query).catch(refuse)]);
  const filters: FinanceFilters = {
    ...EMPTY_FINANCE_FILTERS,
    q: query.q ?? "",
    financialStatus: query.financialStatus ?? "",
    buildingId: query.buildingId ?? "",
    floorId: query.floorId ?? "",
    unitTypeId: query.unitTypeId ?? "",
    contractStatus: query.contractStatus ?? "",
    overdue: query.overdue ? "1" : "",
    dueFrom: query.dueFrom ? query.dueFrom.toISOString().slice(0, 10) : "",
    dueTo: query.dueTo ? query.dueTo.toISOString().slice(0, 10) : "",
    currency: query.currency ?? "",
    sort: query.sort,
  };

  return (
    <div className="space-y-5">
      <RecordContextHeader title={project.name} subtitle={project.code} status={project.status} />
      <FinanceViews projectId={project.id} active="units" both={actions.canViewFinance} />
      {structure.totals.units === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong bg-surface-muted px-4 py-10 text-center text-table text-fg-muted" data-testid="finance-units-empty">
          {t("structurePages.financeNoUnits")}
        </p>
      ) : (
        <FinanceInventory
          projectId={project.id}
          initial={inventory}
          initialFilters={filters}
          buildings={structure.buildings.map((building) => ({ id: building.id, name: building.name, floors: building.floors.map((floor) => ({ id: floor.id, name: floor.name })) }))}
          unitTypes={structure.unitTypes.map((type) => ({ id: type.id, name: type.name }))}
        />
      )}
    </div>
  );
}
