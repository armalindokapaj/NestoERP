import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecordDocuments } from "@/components/documents/record-documents";
import { orNotFound } from "@/components/engineering/page-helpers";
import { requireModule } from "@/lib/context/current-user";
import { getContractor } from "@/lib/modules/contractors/contractor.service";

type Params = { params: Promise<{ contractorId: string }> };

export const metadata: Metadata = { title: "Contractor documents" };

/** Prequalification, registration and correspondence — canonical Documents on the contractor (PRD #46 §125, §126). */
export default async function ContractorDocumentsPage({ params }: Params) {
  const { contractorId } = await params;
  const context = await requireModule("contractors");
  const contractor = await orNotFound(getContractor(context, contractorId));
  if (!contractor.capabilities.canViewDocuments) redirect("/access-denied");
  return (
    <section className="space-y-3">
      <h2 className="text-section font-semibold text-fg">Documents</h2>
      <RecordDocuments context={context} entityType="contractor" entityId={contractor.id} canAttach={contractor.capabilities.canUploadDocuments} emptyTitle="No documents on file." emptyDescription="Prequalification forms, registration certificates and correspondence." />
    </section>
  );
}
