import { contractorsLabel } from "@/lib/i18n/modules/contractors/labels";
import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WorkPackageTable } from "@/components/contractors/contractor-tables";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { flat, keepPageInRange, pageHref, registerMeta, type SearchParams } from "@/components/engineering/page-helpers";
import { ModulePage } from "@/components/modules/module-page";
import { NoResultsState, hasActiveFilters } from "@/components/ui/empty-state";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { contractorsOpen } from "@/lib/modules/contractors/contractor.permissions";
import { workPackageListSchema } from "@/lib/modules/contractors/contractor.schema";
import { WORK_PACKAGE_STATUSES, WORK_PACKAGE_STATUS_LABELS } from "@/lib/modules/contractors/contractor.types";
import { listWorkPackages } from "@/lib/modules/work-packages/work-package.service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("contractors"))("meta.workPackages") };
}

/** Work packages across every project the reader can open (PRD #46 §207). */
export default async function WorkPackagesPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("contractors");
  if (!contractorsOpen(context, "work_package.view")) redirect("/access-denied");
  const experience = resolveModuleExperience(context, "contractors");
  const params = await searchParams;
  const t = await getTranslations("contractors");
  const query = workPackageListSchema.parse(flat(params));
  const result = await listWorkPackages(context, query);
  // The register pages with a true count instead of stopping silently at 50 (AUD-08 §4, DT-05).
  keepPageInRange("/contractors/work-packages", params, query.page, result);
  return (
    <ModulePage experience={experience} activeSection="work-packages" description={t("workPackagesPage.description")}>
      <div className="space-y-4">
        <ListToolbar searchPlaceholder={t("workPackagesPage.search")} searchParam="q" filters={[{ param: "status", label: t("workPackagesPage.status"), options: WORK_PACKAGE_STATUSES.map((value) => ({ value, label: contractorsLabel(t, "workPackageStatus", value, WORK_PACKAGE_STATUS_LABELS[value]) })) }]} />
        {result.items.length === 0 && hasActiveFilters(params, ["q", "status"]) ? (
          <NoResultsState noun={t("workPackagesPage.noun")} clearHref="/contractors/work-packages" />
        ) : (
          <WorkPackageTable items={result.items} showProject />
        )}
        <Pagination meta={registerMeta(result)} buildHref={(page) => pageHref("/contractors/work-packages", params, page)} />
      </div>
    </ModulePage>
  );
}
