import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FinanceRecordDocuments } from "@/components/finance/record-documents";
import { loadCommitment } from "../../commitment-context";
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
      <FinanceRecordDocuments
        context={context}
        entityType="commitment"
        entityId={commitment.id}
        canAttach={commitment.status !== "ARCHIVED"}
      />
    </div>
  );
}
