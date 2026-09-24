import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { LeaveActions } from "@/components/hr/leave-actions";
import { HrRecordDocuments } from "@/components/hr/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { can } from "@/lib/access/can";
import { leaveTypeLabels } from "@/lib/modules/hr/hr.status";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { formatDays } from "@/components/hr/hr-format";
import { leaveBreadcrumbs, leaveLabel, loadLeave } from "./leave-context";

type Params = { params: Promise<{ leaveId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { leaveId } = await params;
  try {
    const { request } = await loadLeave(leaveId);
    return { title: leaveLabel(request) };
  } catch {
    return { title: "Leave request" };
  }
}

/**
 * A leave request (PRD #16 §71, §95).
 *
 * The reason is rendered only when the DTO carries it — the service omits it
 * entirely for a reader who is neither the requester nor holds
 * `hr.leave.reason.view`, because a reason may be medical.
 */
export default async function LeaveDetailPage({ params }: Params) {
  const { leaveId } = await params;
  const { context, request } = await loadLeave(leaveId);

  const reasonWithheld = request.reason === undefined;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={leaveBreadcrumbs(request)}
        title={leaveTypeLabels[request.leaveType]}
        subtitle={request.employee.fullName}
        status={request.status}
        meta={[
          { label: "From", value: formatDate(request.startDate) },
          { label: "To", value: formatDate(request.endDate) },
          {
            label: "Working days",
            value: <span className="tabular-nums">{formatDays(request.days)}</span>,
          },
        ]}
        actions={<LeaveActions request={request} />}
      />

      {request.status === "REJECTED" && request.decisionNote ? (
        <p className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong">
          Rejected: {request.decisionNote}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">Reason</h2>
          {reasonWithheld ? (
            <p className="mt-2 text-table text-fg-subtle">
              A reason may be personal, so it is shown only to the person who asked and to readers
              with the reason permission.
            </p>
          ) : request.reason ? (
            <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">{request.reason}</p>
          ) : (
            <p className="mt-2 text-table text-fg-subtle">No reason given.</p>
          )}
        </section>

        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">Details</h2>
          <DetailGrid
            className="mt-4"
            items={[
              {
                label: "Employee",
                value: can(context, "hr.employee.view") ? (
                  <Link
                    href={`/hr/employees/${request.employee.employeeId}`}
                    className="hover:text-accent"
                  >
                    {request.employee.fullName}
                  </Link>
                ) : (
                  <PersonLink employeeId={request.employee.employeeId} name={request.employee.fullName} />
                ),
              },
              { label: "Type", value: leaveTypeLabels[request.leaveType] },
              {
                label: "Submitted",
                value: request.submittedAt ? formatDateTime(request.submittedAt) : "Not yet",
              },
              {
                label: "Decided by",
                value: request.decidedByMemberId ? <PersonLink memberId={request.decidedByMemberId} name={request.decidedByName} /> : "—",
              },
              {
                label: "Decided",
                value: request.decidedAt ? formatDateTime(request.decidedAt) : "—",
              },
            ]}
          />
        </section>
      </div>

      {request.capabilities.canViewDocuments ? (
        <section className="space-y-3">
          <h2 className="text-card font-semibold text-fg">Documents</h2>
          <HrRecordDocuments
            context={context}
            entityType="leave_request"
            entityId={request.id}
            canAttach={request.status !== "CANCELLED"}
            emptyDescription="Sick notes and supporting files filed against this request appear here."
          />
        </section>
      ) : null}
    </div>
  );
}
