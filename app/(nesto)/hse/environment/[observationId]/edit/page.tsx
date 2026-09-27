import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ObservationForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateObservationAction } from "@/lib/actions/hse";
import * as environment from "@/lib/modules/hse/environment/environment.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("page.editObservation") };
}

type Params = { params: Promise<{ observationId: string }> };

export default async function EditObservationPage({ params }: Params) {
  const { observationId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.environment.update")) notFound();

  let observation;
  try {
    observation = await environment.getObservation(context, observationId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!observation.capabilities.canEdit) notFound();

  const options = await environment.observationFormOptions(context);
  const update = updateObservationAction.bind(null, observationId);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.environment.title"), href: "/hse/environment" },
          { label: observation.observationNumber, href: `/hse/environment/${observationId}` },
          { label: t("template.detail.edit") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("page.editNumber", { number: observation.observationNumber })}</h1>
      </div>

      <ObservationForm
        action={update}
        cancelHref={`/hse/environment/${observationId}`}
        submitLabel={t("page.saveObservation")}
        pendingLabel={t("page.saving")}
        versionUpdatedAt={observation.updatedAt}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        canAssign
        values={{
          category: observation.category,
          title: observation.title,
          description: observation.description,
          projectId: observation.project?.id ?? "",
          observedAt: observation.observedAt.slice(0, 10),
          locationText: observation.locationText ?? "",
          severity: observation.severity,
          assignedToMemberId: observation.assignedTo?.memberId ?? "",
          immediateAction: observation.immediateAction ?? "",
          dueDate: observation.dueDate?.slice(0, 10) ?? "",
        }}
      />
    </div>
  );
}
