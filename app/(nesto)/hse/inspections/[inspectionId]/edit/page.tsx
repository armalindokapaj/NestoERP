import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InspectionForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateInspectionAction } from "@/lib/actions/hse";
import * as inspections from "@/lib/modules/hse/inspections/inspection.service";
import { inspectionTypeLabels } from "@/lib/modules/hse/hse.status";
import { getTranslations } from "@/lib/i18n/server";
import { hseLabel } from "@/lib/i18n/modules/hse/labels";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("page.editInspection") };
}

type Params = { params: Promise<{ inspectionId: string }> };

export default async function EditInspectionPage({ params }: Params) {
  const { inspectionId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.inspection.create")) notFound();

  let inspection;
  try {
    inspection = await inspections.getInspection(context, inspectionId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!inspection.capabilities.canEdit) notFound();

  const options = await inspections.inspectionFormOptions(context);
  const update = updateInspectionAction.bind(null, inspectionId);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.inspections.title"), href: "/hse/inspections" },
          { label: inspection.inspectionNumber, href: `/hse/inspections/${inspectionId}` },
          { label: t("template.detail.edit") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("page.editNumber", { number: inspection.inspectionNumber })}</h1>
      </div>

      <InspectionForm
        action={update}
        cancelHref={`/hse/inspections/${inspectionId}`}
        submitLabel={t("page.saveInspection")}
        pendingLabel={t("page.saving")}
        versionUpdatedAt={inspection.updatedAt}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        templates={options.templates.map((template) => ({
          value: template.id,
          label: `${template.code} — ${template.name} (${hseLabel(t, "inspectionType", template.inspectionType, inspectionTypeLabels[template.inspectionType])}, v${template.version})`,
        }))}
        values={{
          inspectionType: inspection.inspectionType,
          projectId: inspection.project?.id ?? "",
          templateId: inspection.template?.id ?? "",
          assignedInspectorMemberId: inspection.assignedInspector?.memberId ?? "",
          scheduledDate: inspection.scheduledDate?.slice(0, 10) ?? "",
          locationText: inspection.locationText ?? "",
          summary: inspection.summary ?? "",
        }}
      />
    </div>
  );
}
