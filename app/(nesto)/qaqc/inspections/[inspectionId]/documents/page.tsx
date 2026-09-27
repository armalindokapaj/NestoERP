import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";

import { QaqcRecordDocuments } from "@/components/qaqc/record-documents";
import { InspectionPageShell, loadInspectionPage } from "../inspection-shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.documents") };
}

type Params = { params: Promise<{ inspectionId: string }> };

/** Evidence filed against an inspection (PRD #21 §178). */
export default async function InspectionDocumentsPage({ params }: Params) {
  const { inspectionId } = await params;
  const { context, inspection } = await loadInspectionPage(inspectionId, "documents");
  const t = await getTranslations("qaqc");

  return (
    <InspectionPageShell context={context} inspection={inspection} tab="documents">
      <QaqcRecordDocuments
        context={context}
        entityType="quality_inspection"
        entityId={inspection.id}
        emptyDescription={t("documents.inspection")}
      />
    </InspectionPageShell>
  );
}
