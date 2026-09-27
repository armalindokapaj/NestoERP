import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { SalesActivityFeed } from "@/components/sales/sales-activity";
import { SkeletonTable } from "@/components/ui/loading-state";
import { opportunityContext } from "../opportunity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("meta.opportunityActivity") };
}

type Params = { params: Promise<{ opportunityId: string }> };

/** One deal's full history (PRD #17 §147, §410). */
export default async function OpportunityActivityPage({ params }: Params) {
  const { opportunityId } = await params;
  const { context, opportunity } = await opportunityContext(opportunityId);
  const t = await getTranslations("sales");

  if (!opportunity.capabilities.canViewActivity) {
    redirect(`/sales/opportunities/${opportunityId}`);
  }

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: t("crumbs.sales"), href: "/sales" },
          { label: t("crumbs.opportunities"), href: "/sales/opportunities" },
          { label: opportunity.name, href: `/sales/opportunities/${opportunityId}` },
          { label: t("crumbs.activity") },
        ]}
        title={t("detail.activityTitle", { name: opportunity.name })}
        status={opportunity.stage}
      />

      <Suspense fallback={<SkeletonTable rows={5} />}>
        <SalesActivityFeed context={context} entityType="Opportunity" entityId={opportunityId} />
      </Suspense>
    </div>
  );
}
