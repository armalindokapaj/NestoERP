import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { SalesExportLink } from "@/components/sales/export-link";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { LeadList } from "./lead-list";

export const metadata: Metadata = { title: "Leads" };

/** The lead list (PRD #17 §37, §292). */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("sales");
  if (!can(context, "sales.lead.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "sales");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="leads"
      actions={
        <div className="flex items-center gap-2">
          {can(context, "sales.export") ? <SalesExportLink type="leads" /> : null}
          {can(context, "sales.lead.create") ? (
            <Button asChild size="sm">
              <Link href="/sales/leads/new">New lead</Link>
            </Button>
          ) : null}
        </div>
      }
    >
      {/* In-page, below the module guard, so no permission flash is possible
          (PRD #17 §292). */}
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <LeadList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
