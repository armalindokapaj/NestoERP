import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { ModulePage } from "@/components/modules/module-page";
import { SalesExportLink } from "@/components/sales/export-link";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { OpportunityList } from "./opportunity-list";

export const metadata: Metadata = { title: "Opportunities" };

/** The opportunity list (PRD #17 §71, §292). */
export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("sales");
  const experience = resolveModuleExperience(context, "sales");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="opportunities"
      actions={
        <div className="flex items-center gap-2">
          {can(context, "sales.export") ? <SalesExportLink type="opportunities" /> : null}
          {can(context, "sales.opportunity.create") ? (
            <Button asChild size="sm">
              <Link href="/sales/opportunities/new">New opportunity</Link>
            </Button>
          ) : null}
        </div>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <OpportunityList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
