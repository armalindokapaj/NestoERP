import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ContractActivityFeed } from "@/components/contracts/contract-activity";
import { RecordContextHeader } from "@/components/modules/record-header";
import { SkeletonTable } from "@/components/ui/loading-state";
import { contractBreadcrumbs, contractContext } from "../contract-context";
import { ContractTabs } from "../contract-tabs";

type Params = { params: Promise<{ contractId: string }> };

export const metadata: Metadata = { title: "Contract activity" };

/**
 * What has happened to this contract (PRD #18 §209, §210).
 *
 * The messages name the record and the action and nothing else. The value, the
 * legal note and the termination reason live in activity metadata, which this
 * feed does not return — everybody who can see the contract at all can read
 * this list (PRD #18 §210).
 */
export default async function ContractActivityPage({ params }: Params) {
  const { contractId } = await params;
  const { context, contract } = await contractContext(contractId);

  if (!contract.capabilities.canViewActivity) notFound();

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={contractBreadcrumbs(contract, "Activity")}
        title={contract.title}
        subtitle={contract.contractNumber}
        status={contract.status}
      />

      <ContractTabs
        contractId={contract.id}
        active="activity"
        capabilities={contract.capabilities}
      />

      <Suspense fallback={<SkeletonTable rows={4} />}>
        <ContractActivityFeed context={context} contractId={contract.id} />
      </Suspense>
    </div>
  );
}
