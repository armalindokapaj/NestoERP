import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { QaqcRecordDocuments } from "@/components/qaqc/record-documents";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";

export const metadata: Metadata = { title: "Documents" };

type Params = { params: Promise<{ ncrId: string }> };

/** Evidence filed against an NCR (PRD #21 §179). */
export default async function NcrDocumentsPage({ params }: Params) {
  const { ncrId } = await params;
  const context = await requireModule("qaqc");

  let ncr;
  try {
    ncr = await ncrs.getNcr(context, ncrId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!ncr.capabilities.canViewDocuments) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "QA/QC", href: "/qaqc" },
          { label: "NCRs", href: "/qaqc/ncrs" },
          { label: ncr.ncrNumber, href: `/qaqc/ncrs/${ncr.id}` },
          { label: "Documents" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Documents</h1>
        <p className="mt-1.5 text-body text-fg-muted">{ncr.ncrNumber}</p>
      </div>

      <QaqcRecordDocuments
        context={context}
        entityType="non_conformance_report"
        entityId={ncr.id}
        emptyDescription="Evidence, supplier correspondence and closure records appear here."
      />
    </div>
  );
}
