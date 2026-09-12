import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RequestForm } from "@/components/procurement/request-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { updateRequestAction } from "@/lib/actions/procurement";
import * as requests from "@/lib/modules/procurement/requests/request.service";

type Params = { params: Promise<{ requestId: string }> };

export const metadata: Metadata = { title: "Edit purchase request" };

/**
 * Edit a request (PRD #19 §55).
 *
 * Only while it is a draft or has been sent back. Once somebody has approved
 * it, the lines are what they approved — changing them afterwards would mean
 * the approval was for something else.
 */
export default async function EditRequestPage({ params }: Params) {
  const { requestId } = await params;
  const context = await requireModule("procurement");

  let request;
  try {
    request = await requests.getRequest(context, requestId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!request.capabilities.canEdit) notFound();

  const options = await requests.requestFormOptions(context);

  async function action(formData: FormData) {
    "use server";
    return updateRequestAction(requestId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Procurement", href: "/procurement" },
          { label: "Requests", href: "/procurement/requests" },
          { label: request.requestNumber, href: `/procurement/requests/${request.id}` },
          { label: "Edit" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Edit purchase request</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {request.requestNumber} — {request.title}
        </p>
      </div>

      <RequestForm
        action={action}
        versionUpdatedAt={request.updatedAt}
        cancelHref={`/procurement/requests/${request.id}`}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        departments={options.departments.map((department) => ({
          value: department.id,
          label: department.name,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        values={{
          title: request.title,
          description: request.description ?? "",
          projectId: request.project?.id ?? "",
          departmentId: request.department?.id ?? "",
          ownerMemberId: request.owner?.memberId ?? "",
          requiredDate: request.requiredDate ?? "",
          priority: request.priority,
          currency: request.currency ?? "",
          items: request.items.map((item) => ({
            id: item.id,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            estimatedUnitPrice: item.estimatedUnitPrice ?? "",
            category: item.category ?? "",
          })),
        }}
      />
    </div>
  );
}
