import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HseRecordDocuments } from "@/components/hse/record-documents";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as inspections from "@/lib/modules/hse/inspections/inspection.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("page.inspectionDocuments") };
}

type Params = { params: Promise<{ inspectionId: string }> };

export default async function InspectionDocumentsPage({ params }: Params) {
  const { inspectionId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");

  let inspection;
  try {
    inspection = await inspections.getInspection(context, inspectionId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!inspection.capabilities.canViewDocuments) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.inspections.title"), href: "/hse/inspections" },
          { label: inspection.inspectionNumber, href: `/hse/inspections/${inspectionId}` },
          { label: t("record.documents") },
        ]}
      />

      <h1 className="text-page font-semibold text-fg">
        {t("page.documentsOn", { number: inspection.inspectionNumber })}
      </h1>

      <HseRecordDocuments context={context} entityType="hse_inspection" entityId={inspection.id} />
    </div>
  );
}
