import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WorkPackageTable } from "@/components/contractors/contractor-tables";
import { orNotFound } from "@/components/engineering/page-helpers";
import { requireModule } from "@/lib/context/current-user";
import { contractorsOpen } from "@/lib/modules/contractors/contractor.permissions";
import { workPackageListSchema } from "@/lib/modules/contractors/contractor.schema";
import { findReadableContractor } from "@/lib/modules/contractors/contractor.service";
import { listWorkPackages } from "@/lib/modules/work-packages/work-package.service";

type Params = { params: Promise<{ contractorId: string }> };

export const metadata: Metadata = { title: "Contractor work packages" };

/** The contractor's work packages across projects (PRD #46 §39, §160). */
export default async function ContractorWorkPackagesPage({ params }: Params) {
  const { contractorId } = await params;
  const context = await requireModule("contractors");
  if (!contractorsOpen(context, "work_package.view")) redirect("/access-denied");
  const contractor = await orNotFound(findReadableContractor(context, contractorId));
  const result = await listWorkPackages(context, workPackageListSchema.parse({ contractorId: contractor.id, includeArchived: "1" }));
  return (
    <section className="space-y-3">
      <h2 className="text-section font-semibold text-fg">Work packages</h2>
      <WorkPackageTable items={result.items} showProject emptyText="No work packages for this contractor." />
    </section>
  );
}
