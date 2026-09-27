import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FinanceRecordDocuments } from "@/components/finance/record-documents";
import { RecordContextHeader } from "@/components/modules/record-header";
import {
  commitmentBreadcrumbs,
  commitmentLabel,
  loadCommitment,
} from "../commitment-context";
import { FinanceRecordTabs } from "../../../invoices/[invoiceId]/record-tabs";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ commitmentId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: t("meta.commitmentDocuments") };
}

export default async function CommitmentDocumentsPage({ params }: Params) {
  const t = await getTranslations("finance");
  const { commitmentId } = await params;
  const { context, commitment } = await loadCommitment(commitmentId);

  if (!commitment.capabilities.canViewDocuments) notFound();

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={await commitmentBreadcrumbs(commitment, t("crumbs.documents"))}
        title={commitmentLabel(commitment)}
        status={commitment.status}
      />

      <FinanceRecordTabs
        basePath={`/finance/commitments/${commitment.id}`}
        active="documents"
        show={{ documents: true, activity: commitment.capabilities.canViewActivity }}
      />

      <FinanceRecordDocuments
        context={context}
        entityType="commitment"
        entityId={commitment.id}
        canAttach={commitment.status !== "ARCHIVED"}
      />
    </div>
  );
}
