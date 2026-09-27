import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HseRecordDocuments } from "@/components/hse/record-documents";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as incidents from "@/lib/modules/hse/incidents/incident.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("page.incidentDocuments") };
}

type Params = { params: Promise<{ incidentId: string }> };

export default async function IncidentDocumentsPage({ params }: Params) {
  const { incidentId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");

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
          { label: t("pages.incidents.title"), href: "/hse/incidents" },
          { label: incident.incidentNumber, href: `/hse/incidents/${incidentId}` },
          { label: t("record.documents") },
        ]}
      />

      <h1 className="text-page font-semibold text-fg">
        {t("page.documentsOn", { number: incident.incidentNumber })}
      </h1>

      <HseRecordDocuments
        context={context}
        entityType="incident"
        entityId={incident.id}
        emptyDescription={t("incident.detail.documentsEmpty")}
      />
    </div>
  );
}
