import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { SalesExportLink } from "@/components/sales/export-link";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { resolveSalesExperience } from "@/lib/modules/sales/sales.workspace";
import { LeadList } from "./lead-list";

export const metadata: Metadata = { title: "Leads" };

/**
 * The lead list (PRD #17 §37, §292).
 *
 * In the Group workspace it lists the leads of every company the reader may read
 * Sales in, each row naming its company (Workspace Context §37, §45). Capturing
 * a lead, and the export, are one company's, so neither is offered there.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("sales");
  const grouped = inGroupWorkspace(context);
  // The company grant is the session's own; in the group each company answers
  // for itself, and one where the reader holds nothing simply has no rows.
  if (!grouped && !can(context, "sales.lead.view")) redirect("/access-denied");

  const experience = await resolveSalesExperience(context);
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="leads"
      actions={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {!grouped && can(context, "sales.export") ? <SalesExportLink type="leads" /> : null}
          {!grouped && can(context, "sales.lead.create") ? (
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
