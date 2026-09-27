import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";

import { ModulePage } from "@/components/modules/module-page";
import { SalesExportLink } from "@/components/sales/export-link";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/loading-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { resolveSalesExperience } from "@/lib/modules/sales/sales.workspace";
import { OpportunityList } from "./opportunity-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("meta.opportunities") };
}

/**
 * The opportunity list (PRD #17 §71, §292).
 *
 * In the Group workspace it lists the deals of every company the reader may read
 * Sales in, each row naming its company (Workspace Context §37, §45). Opening a
 * deal, and the export, are one company's, so neither is offered there.
 */
export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("sales");
  const t = await getTranslations("sales");
  const grouped = inGroupWorkspace(context);
  const experience = await resolveSalesExperience(context);
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="opportunities"
      actions={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {!grouped && can(context, "sales.export") ? <SalesExportLink type="opportunities" /> : null}
          {!grouped && can(context, "sales.opportunity.create") ? (
            <Button asChild size="sm">
              <Link href="/sales/opportunities/new">{t("lists.newOpportunity")}</Link>
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
