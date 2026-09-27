import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RiskAssessmentForm } from "@/components/hse/risk-assessment-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateRiskAssessmentAction } from "@/lib/actions/hse";
import * as risk from "@/lib/modules/hse/risk-assessments/risk.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("page.editRiskAssessment") };
}

type Params = { params: Promise<{ assessmentId: string }> };

export default async function EditRiskAssessmentPage({ params }: Params) {
  const { assessmentId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.risk.update")) notFound();

  let assessment;
  try {
    assessment = await risk.getRiskAssessment(context, assessmentId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const may = assessment.capabilities;
  if (!may.canEdit && !may.canVersion) notFound();

  const options = await risk.riskFormOptions(context);
  const update = updateRiskAssessmentAction.bind(null, assessmentId);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.riskAssessments.title"), href: "/hse/risk-assessments" },
          {
            label: assessment.assessmentNumber,
            href: `/hse/risk-assessments/${assessmentId}`,
          },
          { label: may.canEdit ? t("template.detail.edit") : t("page.newVersion") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">
          {may.canEdit
            ? t("page.editNumber", { number: assessment.assessmentNumber })
            : t("page.newVersionOf", { number: assessment.assessmentNumber })}
        </h1>
      </div>

      <RiskAssessmentForm
        action={update}
        cancelHref={`/hse/risk-assessments/${assessmentId}`}
        submitLabel={may.canEdit ? t("page.saveAssessment") : t("page.createVersion", { version: assessment.version + 1 })}
        pendingLabel={t("page.saving")}
        versionUpdatedAt={assessment.updatedAt}
        willVersion={!may.canEdit}
        currentVersion={assessment.version}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        values={{
          title: assessment.title,
          description: assessment.description ?? "",
          projectId: assessment.project?.id ?? "",
          activityType: assessment.activityType ?? "",
          locationText: assessment.locationText ?? "",
          ownerMemberId: assessment.owner?.memberId ?? "",
          assessmentDate: assessment.assessmentDate.slice(0, 10),
          reviewDate: assessment.reviewDate?.slice(0, 10) ?? "",
          items: assessment.items.map((item) => ({
            hazardDescription: item.hazardDescription,
            existingControls: item.existingControls ?? "",
            likelihood: String(item.risk.likelihood),
            severity: String(item.risk.severity),
            additionalControls: item.additionalControls ?? "",
            residualLikelihood: item.residualRisk ? String(item.residualRisk.likelihood) : "",
            residualSeverity: item.residualRisk ? String(item.residualRisk.severity) : "",
            responsibleMemberId: item.responsible?.memberId ?? "",
            dueDate: item.dueDate?.slice(0, 10) ?? "",
          })),
        }}
      />
    </div>
  );
}
