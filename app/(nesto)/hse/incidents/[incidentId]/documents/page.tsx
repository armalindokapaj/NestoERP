import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HseRecordDocuments } from "@/components/hse/record-documents";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as incidents from "@/lib/modules/hse/incidents/incident.service";

export const metadata: Metadata = { title: "Incident documents" };

type Params = { params: Promise<{ incidentId: string }> };

export default async function IncidentDocumentsPage({ params }: Params) {
  const { incidentId } = await params;
  const context = await requireModule("hse");

  let incident;
  try {
    incident = await incidents.getIncident(context, incidentId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!incident.capabilities.canViewDocuments) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Incidents", href: "/hse/incidents" },
          { label: incident.incidentNumber, href: `/hse/incidents/${incidentId}` },
          { label: "Documents" },
        ]}
      />

      <h1 className="text-page font-semibold text-fg">
        Documents on {incident.incidentNumber}
      </h1>

      <HseRecordDocuments
        context={context}
        entityType="incident"
        entityId={incident.id}
        emptyDescription="Photographs and investigation reports appear here. Medical records do not belong in NESTO."
      />
    </div>
  );
}
