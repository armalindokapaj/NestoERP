import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { SalesRecordDocuments } from "@/components/sales/record-documents";
import { SkeletonTable } from "@/components/ui/loading-state";
import { opportunityContext } from "../opportunity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("meta.opportunityDocuments") };
}

type Params = { params: Promise<{ opportunityId: string }> };

/** Canonical Documents filed against this deal (PRD #17 §145, §265). */
export default async function OpportunityDocumentsPage({ params }: Params) {
  const { opportunityId } = await params;
  const { context, opportunity } = await opportunityContext(opportunityId);
  const t = await getTranslations("sales");

  if (!opportunity.capabilities.canViewDocuments) {
    redirect(`/sales/opportunities/${opportunityId}`);
  }

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: t("crumbs.sales"), href: "/sales" },
          { label: t("crumbs.opportunities"), href: "/sales/opportunities" },
          { label: opportunity.name, href: `/sales/opportunities/${opportunityId}` },
          { label: t("crumbs.documents") },
        ]}
        title={t("detail.documentsTitle", { name: opportunity.name })}
        status={opportunity.stage}
      />

      <Suspense fallback={<SkeletonTable rows={4} />}>
        <SalesRecordDocuments
          context={context}
          entityType="opportunity"
          entityId={opportunityId}
          emptyDescription={t("detail.dealDocuments")}
        />
      </Suspense>
    </div>
  );
}
