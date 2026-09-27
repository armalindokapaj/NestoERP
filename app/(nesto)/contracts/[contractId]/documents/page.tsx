import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { ContractRecordDocuments } from "@/components/contracts/record-documents";
import { RecordContextHeader } from "@/components/modules/record-header";
import { SkeletonTable } from "@/components/ui/loading-state";
import { contractBreadcrumbs, contractContext } from "../contract-context";
import { ContractTabs } from "../contract-tabs";

type Params = { params: Promise<{ contractId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contracts");
  return { title: t("meta.documents") };
}

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
  const t = await getTranslations("contracts");

  if (!contract.capabilities.canViewDocuments) notFound();

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={contractBreadcrumbs(contract, t("crumbs.documents"), t)}
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
          emptyDescription={t("documents.contractEmpty")}
        />
      </Suspense>
    </div>
  );
}
