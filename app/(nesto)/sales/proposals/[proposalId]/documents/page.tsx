import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { SalesRecordDocuments } from "@/components/sales/record-documents";
import { SkeletonTable } from "@/components/ui/loading-state";
import { proposalContext } from "../proposal-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("meta.proposalDocuments") };
}

type Params = { params: Promise<{ proposalId: string }> };

/** Canonical Documents on a proposal (PRD #17 §126, §146). */
export default async function ProposalDocumentsPage({ params }: Params) {
  const { proposalId } = await params;
  const { context, proposal } = await proposalContext(proposalId);
  const t = await getTranslations("sales");

  if (!proposal.capabilities.canViewDocuments) redirect(`/sales/proposals/${proposalId}`);

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: t("crumbs.sales"), href: "/sales" },
          { label: t("crumbs.proposals"), href: "/sales/proposals" },
          { label: proposal.proposalNumber, href: `/sales/proposals/${proposalId}` },
          { label: t("crumbs.documents") },
        ]}
        title={t("detail.documentsTitle", { name: proposal.proposalNumber })}
        status={proposal.status}
      />

      <Suspense fallback={<SkeletonTable rows={4} />}>
        <SalesRecordDocuments
          context={context}
          entityType="proposal"
          entityId={proposalId}
          emptyDescription={t("detail.proposalDocumentsFull")}
        />
      </Suspense>
    </div>
  );
}
