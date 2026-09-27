import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WorkPackageTable } from "@/components/contractors/contractor-tables";
import { Pagination } from "@/components/data/pagination";
import { keepPageInRange, one, orNotFound, pageHref, registerMeta, type SearchParams } from "@/components/engineering/page-helpers";
import { requireModule } from "@/lib/context/current-user";
import { contractorsOpen } from "@/lib/modules/contractors/contractor.permissions";
import { workPackageListSchema } from "@/lib/modules/contractors/contractor.schema";
import { findReadableContractor } from "@/lib/modules/contractors/contractor.service";
import { listWorkPackages } from "@/lib/modules/work-packages/work-package.service";

type Params = { params: Promise<{ contractorId: string }>; searchParams: SearchParams };

export const metadata: Metadata = { title: "Contractor work packages" };

/**
 * The contractor's work packages across projects (PRD #46 §39, §160), archived
 * ones included — every one of them, with a count and pages rather than
 * silently the first 50 (AUD-08 §4, DT-05).
 */
export default async function ContractorWorkPackagesPage({ params, searchParams }: Params) {
  const [{ contractorId }, search] = await Promise.all([params, searchParams]);
  const context = await requireModule("contractors");
  if (!contractorsOpen(context, "work_package.view")) redirect("/access-denied");
  const contractor = await orNotFound(findReadableContractor(context, contractorId));
  const query = workPackageListSchema.parse({ contractorId: contractor.id, includeArchived: "1", page: one(search.page) });
  const result = await listWorkPackages(context, query);
  const base = `/contractors/${contractor.id}/work-packages`;
  keepPageInRange(base, search, query.page, result);
  return (
    <section className="space-y-3">
      <h2 className="text-section font-semibold text-fg">Work packages</h2>
      <WorkPackageTable items={result.items} showProject emptyText="No work packages for this contractor." />
      <Pagination meta={registerMeta(result)} buildHref={(page) => pageHref(base, search, page)} />
    </section>
  );
}
