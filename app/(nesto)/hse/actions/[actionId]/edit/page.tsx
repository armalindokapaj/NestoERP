import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateHseActionAction } from "@/lib/actions/hse";
import * as actionService from "@/lib/modules/hse/actions/action.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("page.editAction") };
}

type Params = { params: Promise<{ actionId: string }> };

export default async function EditHseActionPage({ params }: Params) {
  const { actionId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.action.update")) notFound();

  let action;
  try {
    action = await actionService.getAction(context, actionId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!action.capabilities.canEdit) notFound();

  const options = await actionService.actionFormOptions(context);
  const update = updateHseActionAction.bind(null, actionId);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.actions.title"), href: "/hse/actions" },
          { label: action.actionNumber, href: `/hse/actions/${actionId}` },
          { label: t("template.detail.edit") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("page.editNumber", { number: action.actionNumber })}</h1>
      </div>

      <ActionForm
        action={update}
        cancelHref={`/hse/actions/${actionId}`}
        submitLabel={t("page.saveAction")}
        pendingLabel={t("page.saving")}
        versionUpdatedAt={action.updatedAt}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        values={{
          actionType: action.actionType,
          title: action.title,
          description: action.description,
          projectId: action.project?.id ?? "",
          assignedToMemberId: action.assignedTo?.memberId ?? "",
          priority: action.priority,
          dueDate: action.dueDate?.slice(0, 10) ?? "",
        }}
      />
    </div>
  );
}
