import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { DefectForm } from "@/components/qaqc/qaqc-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateDefectAction } from "@/lib/actions/qaqc";
import * as defects from "@/lib/modules/qaqc/defects/defect.service";

type Params = { params: Promise<{ defectId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.editDefect") };
}

/** Edit a defect that is not yet closed (PRD #21 §116). */
export default async function EditDefectPage({ params }: Params) {
  const { defectId } = await params;
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");

  let defect;
  try {
    defect = await defects.getDefect(context, defectId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!defect.capabilities.canEdit) notFound();

  const options = await defects.defectFormOptions(context);

  async function action(formData: FormData) {
    "use server";
    return updateDefectAction(defectId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.defects"), href: "/qaqc/defects" },
          { label: defect.defectNumber, href: `/qaqc/defects/${defect.id}` },
          { label: t("crumbs.edit") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.editDefect")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">{defect.defectNumber}</p>
      </div>

      <DefectForm
        action={action}
        versionUpdatedAt={defect.updatedAt}
        cancelHref={`/qaqc/defects/${defect.id}`}
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
        values={{
          title: defect.title,
          description: defect.description,
          projectId: defect.project.id,
          inspectionId: defect.inspection?.id ?? "",
          severity: defect.severity,
          locationText: defect.locationText ?? "",
          assignedToMemberId: defect.assignedTo?.memberId ?? "",
          dueDate: defect.dueDate?.slice(0, 10) ?? "",
        }}
      />
    </div>
  );
}
