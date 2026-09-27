import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PermitForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updatePermitAction } from "@/lib/actions/hse";
import * as permits from "@/lib/modules/hse/permits/permit.service";
import { companyZone, instantToWallClock } from "@/lib/modules/hse/hse.time";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("page.editPermit") };
}

type Params = { params: Promise<{ permitId: string }> };

export default async function EditPermitPage({ params }: Params) {
  const { permitId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.permit.update")) notFound();

  let permit;
  try {
    permit = await permits.getPermit(context, permitId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  // An ACTIVE permit's core terms are frozen (PRD #22 §351).
  if (!permit.capabilities.canEdit) notFound();

  const options = await permits.permitFormOptions(context);
  const zone = await companyZone(context.companyId);
  const update = updatePermitAction.bind(null, permitId);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("page.crumbPermits"), href: "/hse/permits" },
          { label: permit.permitNumber, href: `/hse/permits/${permitId}` },
          { label: t("template.detail.edit") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("page.editNumber", { number: permit.permitNumber })}</h1>
      </div>

      <PermitForm
        action={update}
        cancelHref={`/hse/permits/${permitId}`}
        submitLabel={t("page.savePermit")}
        pendingLabel={t("page.saving")}
        versionUpdatedAt={permit.updatedAt}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        assessments={options.assessments.map((assessment) => ({
          value: assessment.id,
          label: `${assessment.assessmentNumber} v${assessment.version} — ${assessment.title}`,
        }))}
        values={{
          permitType: permit.permitType,
          title: permit.title,
          projectId: permit.project.id,
          locationText: permit.locationText,
          riskAssessmentId: permit.riskAssessment?.id ?? "",
          // The company's wall clock, as the form sends it back (AUD-09 §4, FV-07).
          validFrom: instantToWallClock(permit.validFrom, zone),
          validUntil: instantToWallClock(permit.validUntil, zone),
          responsibleMemberId: permit.responsible?.memberId ?? "",
          hazardsSummary: permit.hazardsSummary ?? "",
          controlsSummary: permit.controlsSummary ?? "",
          ppeRequirements: permit.ppeRequirements ?? "",
          specialConditions: permit.specialConditions ?? "",
        }}
      />
    </div>
  );
}
