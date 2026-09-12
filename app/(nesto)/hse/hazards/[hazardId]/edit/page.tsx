import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HazardForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateHazardAction } from "@/lib/actions/hse";
import * as hazards from "@/lib/modules/hse/hazards/hazard.service";

export const metadata: Metadata = { title: "Edit hazard" };

type Params = { params: Promise<{ hazardId: string }> };

export default async function EditHazardPage({ params }: Params) {
  const { hazardId } = await params;
  const context = await requireModule("hse");
  if (!can(context, "hse.hazard.update")) notFound();

  let hazard;
  try {
    hazard = await hazards.getHazard(context, hazardId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!hazard.capabilities.canEdit) notFound();

  const options = await hazards.hazardFormOptions(context);
  const update = updateHazardAction.bind(null, hazardId);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: "Hazards", href: "/hse/hazards" },
          { label: hazard.hazardNumber, href: `/hse/hazards/${hazardId}` },
          { label: "Edit" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Edit {hazard.hazardNumber}</h1>
      </div>

      <HazardForm
        action={update}
        cancelHref={`/hse/hazards/${hazardId}`}
        submitLabel="Save hazard"
        pendingLabel="Saving…"
        versionUpdatedAt={hazard.updatedAt}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        canAssign={can(context, "hse.hazard.assign")}
        values={{
          title: hazard.title,
          description: hazard.description,
          projectId: hazard.project?.id ?? "",
          hazardCategory: hazard.hazardCategory,
          likelihood: String(hazard.risk.likelihood),
          severity: String(hazard.risk.severity),
          observedAt: hazard.observedAt.slice(0, 10),
          locationText: hazard.locationText ?? "",
          assignedToMemberId: hazard.assignedTo?.memberId ?? "",
          immediateControl: hazard.immediateControl ?? "",
          controlMeasure: hazard.controlMeasure ?? "",
          dueDate: hazard.dueDate?.slice(0, 10) ?? "",
        }}
      />
    </div>
  );
}
