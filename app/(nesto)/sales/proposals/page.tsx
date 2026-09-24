import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { ModulePage } from "@/components/modules/module-page";
import { SalesExportLink } from "@/components/sales/export-link";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { ProposalList } from "./proposal-list";

export const metadata: Metadata = { title: "Proposals" };

/** The proposal list (PRD #17 §292). */
export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("sales");
  if (!can(context, "sales.proposal.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "sales");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="proposals"
      actions={
        <div className="flex items-center gap-2">
          {can(context, "sales.export") ? <SalesExportLink type="proposals" /> : null}
          {can(context, "sales.proposal.create") ? (
            <Button asChild size="sm">
              <Link href="/sales/proposals/new">New proposal</Link>
            </Button>
          ) : null}
        </div>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <ProposalList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}
