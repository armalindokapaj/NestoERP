import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WorkPackageTable } from "@/components/contractors/contractor-tables";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { flat, keepPageInRange, pageHref, registerMeta, type SearchParams } from "@/components/engineering/page-helpers";
import { ModulePage } from "@/components/modules/module-page";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { contractorsOpen } from "@/lib/modules/contractors/contractor.permissions";
import { workPackageListSchema } from "@/lib/modules/contractors/contractor.schema";
import { WORK_PACKAGE_STATUSES, WORK_PACKAGE_STATUS_LABELS } from "@/lib/modules/contractors/contractor.types";
import { listWorkPackages } from "@/lib/modules/work-packages/work-package.service";

export const metadata: Metadata = { title: "Work packages" };

/** Work packages across every project the reader can open (PRD #46 §207). */
export default async function WorkPackagesPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("contractors");
  if (!contractorsOpen(context, "work_package.view")) redirect("/access-denied");
  const experience = resolveModuleExperience(context, "contractors");
  const params = await searchParams;
  const query = workPackageListSchema.parse(flat(params));
  const result = await listWorkPackages(context, query);
  // The register pages with a true count instead of stopping silently at 50 (AUD-08 §4, DT-05).
  keepPageInRange("/contractors/work-packages", params, query.page, result);
  return (
    <ModulePage experience={experience} activeSection="work-packages" description="Scope on each project, by contractor, with its open work.">
      <div className="space-y-4">
        <ListToolbar searchPlaceholder="Search code or name…" searchParam="q" filters={[{ param: "status", label: "Status", options: WORK_PACKAGE_STATUSES.map((value) => ({ value, label: WORK_PACKAGE_STATUS_LABELS[value] })) }]} />
        <WorkPackageTable items={result.items} showProject />
        <Pagination meta={registerMeta(result)} buildHref={(page) => pageHref("/contractors/work-packages", params, page)} />
      </div>
    </ModulePage>
  );
}
