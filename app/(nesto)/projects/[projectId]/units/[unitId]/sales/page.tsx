import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { UnitSalesPanel } from "@/components/sales/unit-sales/unit-sales-panel";
import { salesCapabilities } from "@/lib/modules/sales/units/unit-sales.core";
import { getUnitSales } from "@/lib/modules/sales/units/unit-sales.service";
import { loadUnitPage, UnitShell } from "../unit-page";

type Params = { params: Promise<{ projectId: string; unitId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: "Unit sales" };

/** The unit's commercial side, on the unit's own page (E-05E §15): no separate Sales unit page. */
export default async function UnitSalesPage({ params, searchParams }: Params) {
  const { projectId, unitId } = await params;
  const action = (await searchParams).action;
  const page = await loadUnitPage(projectId, unitId);
  if (!salesCapabilities(page.context).canView) redirect("/access-denied");
  const sales = await getUnitSales(page.context, page.unit.id);
  return (
    <UnitShell page={page} active="sales">
      <UnitSalesPanel sales={sales} initialAction={typeof action === "string" ? action : null} />
    </UnitShell>
  );
}
