import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { SalesRecordDocuments } from "@/components/sales/record-documents";
import { SkeletonTable } from "@/components/ui/loading-state";
import { proposalContext } from "../proposal-context";

export const metadata: Metadata = { title: "Proposal documents" };

type Params = { params: Promise<{ proposalId: string }> };

/** Canonical Documents on a proposal (PRD #17 §126, §146). */
export default async function ProposalDocumentsPage({ params }: Params) {
  const { proposalId } = await params;
  const { context, proposal } = await proposalContext(proposalId);

  if (!proposal.capabilities.canViewDocuments) redirect(`/sales/proposals/${proposalId}`);

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "Sales", href: "/sales" },
          { label: "Proposals", href: "/sales/proposals" },
          { label: proposal.proposalNumber, href: `/sales/proposals/${proposalId}` },
          { label: "Documents" },
        ]}
        title={`${proposal.proposalNumber} — documents`}
        status={proposal.status}
      />

      <Suspense fallback={<SkeletonTable rows={4} />}>
        <SalesRecordDocuments
          context={context}
          entityType="proposal"
          entityId={proposalId}
          emptyDescription="The proposal PDF and any pricing or scope attachments appear here. NESTO does not generate the PDF."
        />
      </Suspense>
    </div>
  );
}
