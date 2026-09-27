import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { InspectionForm } from "@/components/qaqc/qaqc-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateInspectionAction } from "@/lib/actions/qaqc";
import * as inspections from "@/lib/modules/qaqc/inspections/inspection.service";

type Params = { params: Promise<{ inspectionId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.editInspection") };
}

/** Edit an inspection that has not yet started (PRD #21 §66). */
export default async function EditInspectionPage({ params }: Params) {
  const { inspectionId } = await params;
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");

  let inspection;
  try {
    inspection = await inspections.getInspection(context, inspectionId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!inspection.capabilities.canEdit) notFound();

  const options = await inspections.inspectionFormOptions(context);

  async function action(formData: FormData) {
    "use server";
    return updateInspectionAction(inspectionId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.inspections"), href: "/qaqc/inspections" },
          { label: inspection.inspectionNumber, href: `/qaqc/inspections/${inspection.id}` },
          { label: t("crumbs.edit") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.editInspection")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">{inspection.inspectionNumber}</p>
      </div>

      <InspectionForm
        action={action}
        versionUpdatedAt={inspection.updatedAt}
        cancelHref={`/qaqc/inspections/${inspection.id}`}
        submitLabel={t("common.saveChanges")}
        pendingLabel={t("common.saving")}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        templates={options.templates}
        receipts={options.receipts.map((receipt) => ({
          value: receipt.id,
          label: `${receipt.receiptNumber} — ${receipt.supplier.name}`,
        }))}
        requests={options.requests.map((request) => ({
          value: request.id,
          label: `${request.requestNumber} — ${request.title}`,
        }))}
        values={{
          inspectionType: inspection.inspectionType,
          requestId: inspection.requestId ?? "",
          templateId: inspection.templateId ?? "",
          projectId: inspection.project?.id ?? "",
          goodsReceiptId: inspection.source?.id ?? "",
          assignedInspectorMemberId: inspection.assignedInspector?.memberId ?? "",
          inspectionDate: inspection.inspectionDate?.slice(0, 10) ?? "",
          locationText: inspection.locationText ?? "",
          workReference: inspection.workReference ?? "",
          drawingReference: inspection.drawingReference ?? "",
          specificationReference: inspection.specificationReference ?? "",
          summary: inspection.summary ?? "",
        }}
      />
    </div>
  );
}
