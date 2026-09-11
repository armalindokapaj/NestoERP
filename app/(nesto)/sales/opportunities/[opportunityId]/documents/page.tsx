import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { SalesRecordDocuments } from "@/components/sales/record-documents";
import { SkeletonTable } from "@/components/ui/loading-state";
import { opportunityContext } from "../opportunity-context";

export const metadata: Metadata = { title: "Opportunity documents" };

type Params = { params: Promise<{ opportunityId: string }> };

/** Canonical Documents filed against this deal (PRD #17 §145, §265). */
export default async function OpportunityDocumentsPage({ params }: Params) {
  const { opportunityId } = await params;
  const { context, opportunity } = await opportunityContext(opportunityId);

  if (!opportunity.capabilities.canViewDocuments) {
    redirect(`/sales/opportunities/${opportunityId}`);
  }

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "Sales", href: "/sales" },
          { label: "Opportunities", href: "/sales/opportunities" },
          { label: opportunity.name, href: `/sales/opportunities/${opportunityId}` },
          { label: "Documents" },
        ]}
        title={`${opportunity.name} — documents`}
        status={opportunity.stage}
      />

      <Suspense fallback={<SkeletonTable rows={4} />}>
        <SalesRecordDocuments
          context={context}
          entityType="opportunity"
          entityId={opportunityId}
          emptyDescription="Briefs, RFPs and client requirements filed against this deal appear here."
        />
      </Suspense>
    </div>
  );
}
