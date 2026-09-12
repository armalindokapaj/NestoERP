import type { Metadata } from "next";

import { QaqcRecordDocuments } from "@/components/qaqc/record-documents";
import { InspectionPageShell, loadInspectionPage } from "../inspection-shell";

export const metadata: Metadata = { title: "Documents" };

type Params = { params: Promise<{ inspectionId: string }> };

/** Evidence filed against an inspection (PRD #21 §178). */
export default async function InspectionDocumentsPage({ params }: Params) {
  const { inspectionId } = await params;
  const { context, inspection } = await loadInspectionPage(inspectionId, "documents");

  return (
    <InspectionPageShell inspection={inspection} tab="documents">
      <QaqcRecordDocuments
        context={context}
        entityType="quality_inspection"
        entityId={inspection.id}
        emptyDescription="Photographs, test certificates and signed sheets filed against this inspection appear here."
      />
    </InspectionPageShell>
  );
}
