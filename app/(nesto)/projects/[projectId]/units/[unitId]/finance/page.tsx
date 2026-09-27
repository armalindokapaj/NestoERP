import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { UnitFinancePanel } from "@/components/finance/unit-finance/unit-finance-panel";
import { financeCapabilities } from "@/lib/modules/finance/units/unit-finance.core";
import { getUnitFinance } from "@/lib/modules/finance/units/unit-finance.service";
import { loadUnitPage, UnitShell } from "../unit-page";

type Params = { params: Promise<{ projectId: string; unitId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("unitPage.financeTitle") };
}

/** The unit's collection, on the unit's own page (E-05F §50, §104): no separate Finance unit page. */
export default async function UnitFinancePage({ params }: Params) {
  const { projectId, unitId } = await params;
  const page = await loadUnitPage(projectId, unitId);
  if (!financeCapabilities(page.context).canView) redirect("/access-denied");
  const finance = await getUnitFinance(page.context, page.unit.id);
  return (
    <UnitShell page={page} active="finance">
      <UnitFinancePanel finance={finance} />
    </UnitShell>
  );
}
