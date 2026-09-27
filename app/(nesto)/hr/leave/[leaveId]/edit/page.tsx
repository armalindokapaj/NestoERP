import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LeaveForm } from "@/components/hr/leave-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { updateLeaveAction } from "@/lib/actions/hr";
import { leaveBreadcrumbs, leaveLabel, loadLeave } from "../leave-context";

type Params = { params: Promise<{ leaveId: string }> };

export const metadata: Metadata = { title: "Edit leave request" };

/**
 * Edit a leave request (PRD #16 §192).
 *
 * Only while it is a draft or has come back rejected. A pending request is with
 * an approver, and an approved one has already moved a balance.
 */
export default async function EditLeavePage({ params }: Params) {
  const { leaveId } = await params;
  const { request } = await loadLeave(leaveId);

  if (!request.capabilities.canEdit) redirect(`/hr/leave/${leaveId}`);

  async function action(formData: FormData) {
    "use server";
    return updateLeaveAction(leaveId, formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={leaveBreadcrumbs(request, "Edit")}
        title={`Edit ${leaveLabel(request)}`}
        status={request.status}
      />

      <LeaveForm
        action={action}
        values={{
          employeeId: request.employee.employeeId,
          leaveType: request.leaveType,
          startDate: request.startDate,
          endDate: request.endDate,
          reason: request.reason ?? null,
          // The DTO leaves the reason out for a reader who may not see it (PRD #16 §95).
          reasonHidden: !("reason" in request),
        }}
        versionUpdatedAt={request.updatedAt}
        cancelHref={`/hr/leave/${leaveId}`}
        submitLabel="Save changes"
        pendingLabel="Saving…"
      />
    </div>
  );
}
