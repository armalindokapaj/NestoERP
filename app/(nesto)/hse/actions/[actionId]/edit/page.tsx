import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/hse/hse-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateHseActionAction } from "@/lib/actions/hse";
import * as actionService from "@/lib/modules/hse/actions/action.service";

export const metadata: Metadata = { title: "Edit action" };

type Params = { params: Promise<{ actionId: string }> };

export default async function EditHseActionPage({ params }: Params) {
  const { actionId } = await params;
  const context = await requireModule("hse");
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
          { label: "Actions", href: "/hse/actions" },
          { label: action.actionNumber, href: `/hse/actions/${actionId}` },
          { label: "Edit" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Edit {action.actionNumber}</h1>
      </div>

      <ActionForm
        action={update}
        cancelHref={`/hse/actions/${actionId}`}
        submitLabel="Save action"
        pendingLabel="Saving…"
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
