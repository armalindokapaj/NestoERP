import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PermitForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updatePermitAction } from "@/lib/actions/hse";
import * as permits from "@/lib/modules/hse/permits/permit.service";

export const metadata: Metadata = { title: "Edit permit" };

type Params = { params: Promise<{ permitId: string }> };

export default async function EditPermitPage({ params }: Params) {
  const { permitId } = await params;
  const context = await requireModule("hse");
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
  const update = updatePermitAction.bind(null, permitId);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Permits", href: "/hse/permits" },
          { label: permit.permitNumber, href: `/hse/permits/${permitId}` },
          { label: "Edit" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Edit {permit.permitNumber}</h1>
      </div>

      <PermitForm
        action={update}
        cancelHref={`/hse/permits/${permitId}`}
        submitLabel="Save permit"
        pendingLabel="Saving…"
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
          validFrom: permit.validFrom.slice(0, 16),
          validUntil: permit.validUntil.slice(0, 16),
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
