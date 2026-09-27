import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { LeaveActions } from "@/components/hr/leave-actions";
import { HrRecordDocuments } from "@/components/hr/record-documents";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { can } from "@/lib/access/can";
import { hrLabel } from "@/components/hr/hr-labels";
import { getTranslations } from "@/lib/i18n/server";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { formatDays } from "@/components/hr/hr-format";
import { leaveBreadcrumbs, leaveLabel, loadLeave } from "./leave-context";

type Params = { params: Promise<{ leaveId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { leaveId } = await params;
  const t = await getTranslations("hr");
  try {
    const { request } = await loadLeave(leaveId);
    return { title: leaveLabel(t, request) };
  } catch {
    return { title: t("meta.leaveRequest") };
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
  const t = await getTranslations("hr");

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={await leaveBreadcrumbs(request)}
        title={hrLabel(t, "leaveType", request.leaveType)}
        subtitle={request.employee.fullName}
        status={request.status}
        meta={[
          { label: t("leave.from"), value: formatDate(request.startDate) },
          { label: t("leave.to"), value: formatDate(request.endDate) },
          {
            label: t("leave.workingDays"),
            value: <span className="tabular-nums">{formatDays(request.days)}</span>,
          },
        ]}
        actions={<LeaveActions request={request} />}
      />

      {request.status === "REJECTED" && request.decisionNote ? (
        <p className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-table text-danger-strong">
          {t("leave.rejectedNote", { note: request.decisionNote })}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">{t("history.reason")}</h2>
          {reasonWithheld ? (
            <p className="mt-2 text-table text-fg-subtle">
              {t("leave.reasonWithheld")}
            </p>
          ) : request.reason ? (
            <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">{request.reason}</p>
          ) : (
            <p className="mt-2 text-table text-fg-subtle">{t("leave.noReason")}</p>
          )}
        </section>

        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">{t("leave.details")}</h2>
          <DetailGrid
            className="mt-4"
            items={[
              {
                label: t("columns.employee"),
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
              { label: t("columns.type"), value: hrLabel(t, "leaveType", request.leaveType) },
              {
                label: t("leave.submitted"),
                value: request.submittedAt ? formatDateTime(request.submittedAt) : t("leave.notYet"),
              },
              {
                label: t("leave.decidedBy"),
                value: request.decidedByMemberId ? <PersonLink memberId={request.decidedByMemberId} name={request.decidedByName} /> : "—",
              },
              {
                label: t("leave.decided"),
                value: request.decidedAt ? formatDateTime(request.decidedAt) : "—",
              },
            ]}
          />
        </section>
      </div>

      {request.capabilities.canViewDocuments ? (
        <section className="space-y-3">
          <h2 className="text-card font-semibold text-fg">{t("tabs.documents")}</h2>
          <HrRecordDocuments
            context={context}
            entityType="leave_request"
            entityId={request.id}
            canAttach={request.status !== "CANCELLED"}
            emptyDescription={t("leave.documentsEmpty")}
          />
        </section>
      ) : null}
    </div>
  );
}
