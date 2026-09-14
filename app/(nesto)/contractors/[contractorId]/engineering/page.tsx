import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Panel } from "@/components/engineering/engineering-ui";
import { orNotFound } from "@/components/engineering/page-helpers";
import { DocumentRegister, RfiRegister, SubmittalRegister } from "@/components/engineering/registers";
import { requireModule } from "@/lib/context/current-user";
import { getContractor } from "@/lib/modules/contractors/contractor.service";
import { listEngineeringDocuments } from "@/lib/modules/engineering/engineering.documents";
import { engineeringOpen } from "@/lib/modules/engineering/engineering.permissions";
import { listRfis } from "@/lib/modules/engineering/engineering.rfis";
import { engineeringDocumentListSchema, rfiListSchema, submittalListSchema } from "@/lib/modules/engineering/engineering.schema";
import { listSubmittals } from "@/lib/modules/engineering/engineering.submittals";

type Params = { params: Promise<{ contractorId: string }> };

export const metadata: Metadata = { title: "Contractor engineering" };

/** The contractor's RFIs, submittals and documents across the reader's projects (PRD #46 §160). */
export default async function ContractorEngineeringPage({ params }: Params) {
  const { contractorId } = await params;
  const context = await requireModule("contractors");
  const contractor = await orNotFound(getContractor(context, contractorId));
  if (!contractor.capabilities.canViewEngineering) redirect("/access-denied");
  const [rfis, submittals, documents] = await Promise.all([
    engineeringOpen(context, "rfi.view") ? listRfis(context, rfiListSchema.parse({ contractorId: contractor.id })) : null,
    engineeringOpen(context, "submittal.view") ? listSubmittals(context, submittalListSchema.parse({ contractorId: contractor.id })) : null,
    engineeringOpen(context, "engineering_document.view") ? listEngineeringDocuments(context, engineeringDocumentListSchema.parse({ contractorId: contractor.id })) : null,
  ]);
  return (
    <div className="space-y-5">
      {rfis ? (
        <Panel title="RFIs" description="Raised on or about this contractor's work.">
          <RfiRegister items={rfis.items} showProject emptyTitle="No RFIs involve this contractor." />
        </Panel>
      ) : null}
      {submittals ? (
        <Panel title="Submittals">
          <SubmittalRegister items={submittals.items} showProject emptyTitle="No submittals from this contractor." />
        </Panel>
      ) : null}
      {documents ? (
        <Panel title="Engineering documents">
          <DocumentRegister items={documents.items} showProject emptyTitle="No engineering documents from this contractor." />
        </Panel>
      ) : null}
    </div>
  );
}
