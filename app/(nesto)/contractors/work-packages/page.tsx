import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WorkPackageTable } from "@/components/contractors/contractor-tables";
import { ListToolbar } from "@/components/data/list-toolbar";
import { flat, type SearchParams } from "@/components/engineering/page-helpers";
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
  const result = await listWorkPackages(context, workPackageListSchema.parse(flat(await searchParams)));
  return (
    <ModulePage experience={experience} activeSection="work-packages" description="Scope on each project, by contractor, with its open work.">
      <div className="space-y-4">
        <ListToolbar searchPlaceholder="Search code or name…" searchParam="q" filters={[{ param: "status", label: "Status", options: WORK_PACKAGE_STATUSES.map((value) => ({ value, label: WORK_PACKAGE_STATUS_LABELS[value] })) }]} />
        <WorkPackageTable items={result.items} showProject />
      </div>
    </ModulePage>
  );
}
