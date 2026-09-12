import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CorrectiveActionForm } from "@/components/qaqc/qaqc-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateActionAction } from "@/lib/actions/qaqc";
import * as actions from "@/lib/modules/qaqc/corrective-actions/action.service";

type Params = { params: Promise<{ actionId: string }> };

export const metadata: Metadata = { title: "Edit corrective action" };

/** Edit an action that has not been verified (PRD #21 §144). */
export default async function EditCorrectiveActionPage({ params }: Params) {
  const { actionId } = await params;
  const context = await requireModule("qaqc");

  let record;
  try {
    record = await actions.getAction(context, actionId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!record.capabilities.canEdit) notFound();

  const options = await actions.actionFormOptions(context);

  async function action(formData: FormData) {
    "use server";
    return updateActionAction(actionId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "QA/QC", href: "/qaqc" },
          { label: "Corrective actions", href: "/qaqc/corrective-actions" },
          { label: record.actionNumber, href: `/qaqc/corrective-actions/${record.id}` },
          { label: "Edit" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Edit corrective action</h1>
        <p className="mt-1.5 text-body text-fg-muted">{record.actionNumber}</p>
      </div>

      <CorrectiveActionForm
        action={action}
        versionUpdatedAt={record.updatedAt}
        cancelHref={`/qaqc/corrective-actions/${record.id}`}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        parentLabel={record.parent?.label ?? null}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        values={{
          title: record.title,
          description: record.description,
          ncrId: record.parent?.kind === "NCR" ? record.parent.id : "",
          defectId: record.parent?.kind === "DEFECT" ? record.parent.id : "",
          inspectionId: record.parent?.kind === "INSPECTION" ? record.parent.id : "",
          projectId: record.project?.id ?? "",
          assignedToMemberId: record.assignedTo?.memberId ?? "",
          dueDate: record.dueDate?.slice(0, 10) ?? "",
        }}
      />
    </div>
  );
}
