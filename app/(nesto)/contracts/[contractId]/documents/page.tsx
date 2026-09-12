import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ContractRecordDocuments } from "@/components/contracts/record-documents";
import { RecordContextHeader } from "@/components/modules/record-header";
import { SkeletonTable } from "@/components/ui/loading-state";
import { contractBreadcrumbs, contractContext } from "../contract-context";
import { ContractTabs } from "../contract-tabs";

type Params = { params: Promise<{ contractId: string }> };

export const metadata: Metadata = { title: "Contract documents" };

/**
 * Files filed against the contract (PRD #18 §196–§204).
 *
 * Canonical Document records under `module: "contracts"` — there is no
 * ContractDocument table. A file is reachable because the reader can reach the
 * contract it is filed against, which the parent-access resolver decides and
 * which fails closed for anything unregistered (PRD #18 §199, §437).
 */
export default async function ContractDocumentsPage({ params }: Params) {
  const { contractId } = await params;
  const { context, contract } = await contractContext(contractId);

  if (!contract.capabilities.canViewDocuments) notFound();

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={contractBreadcrumbs(contract, "Documents")}
        title={contract.title}
        subtitle={contract.contractNumber}
        status={contract.status}
      />

      <ContractTabs
        contractId={contract.id}
        active="documents"
        capabilities={contract.capabilities}
      />

      <Suspense fallback={<SkeletonTable rows={3} />}>
        <ContractRecordDocuments
          context={context}
          entityType="contract"
          entityId={contract.id}
          emptyDescription="The executed copy and any drafts or annexes appear here. A corrected signed copy is filed as a new document — the file that was actually executed is never overwritten."
        />
      </Suspense>
    </div>
  );
}
