import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { AttendanceForm } from "@/components/hr/attendance-form";
import { formatTimeOfDay, formatWorkedMinutes } from "@/components/hr/hr-format";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { AccessError } from "@/lib/access/guards";
import { can } from "@/lib/access/can";
import { updateAttendanceAction } from "@/lib/actions/hr";
import { requireModule } from "@/lib/context/current-user";
import { committed } from "@/lib/forms/committed";
import * as attendance from "@/lib/modules/hr/attendance/attendance.service";
import { attendanceSourceLabels } from "@/lib/modules/hr/hr.status";
import { formatDate, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ attendanceId: string }> };

export const metadata: Metadata = { title: "Attendance day" };

/**
 * One attendance day (PRD #16 §111, §113).
 *
 * A row written from approved leave can only be overridden by somebody holding
 * `hr.attendance.update` — the person it belongs to cannot quietly turn their
 * own approved leave into a working day (PRD #16 §110).
 */
export default async function AttendanceDetailPage({ params }: Params) {
  const { attendanceId } = await params;
  const context = await requireModule("hr");

  let record;
  try {
    record = await attendance.getAttendance(context, attendanceId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  async function action(formData: FormData) {
    "use server";
    const result = await updateAttendanceAction(attendanceId, formData);
    if (!result.ok) return result;
    // Answered, not redirected: the form learns the save committed (AUD-03 §6).
    return committed(`/hr/attendance/${attendanceId}`);
  }

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "HR", href: "/hr" },
          { label: "Attendance", href: "/hr/attendance" },
          { label: `${record.employee.fullName} — ${formatDate(record.date)}` },
        ]}
        title={formatDate(record.date)}
        subtitle={record.employee.fullName}
        status={record.status}
        badges={record.isException ? <Badge tone="warning">Needs a look</Badge> : null}
        meta={[
          { label: "Check in", value: formatTimeOfDay(record.checkIn) },
          { label: "Check out", value: formatTimeOfDay(record.checkOut) },
          { label: "Worked", value: formatWorkedMinutes(record.workedMinutes) },
        ]}
      />

      {record.systemGenerated ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          Written from approved leave. Overriding it needs the attendance permission — cancelling
          the leave removes it automatically.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">Details</h2>
          <DetailGrid
            className="mt-4"
            items={[
              {
                label: "Employee",
                value: can(context, "hr.employee.view") ? (
                  <Link
                    href={`/hr/employees/${record.employee.employeeId}`}
                    className="hover:text-accent"
                  >
                    {record.employee.fullName}
                  </Link>
                ) : (
                  <PersonLink employeeId={record.employee.employeeId} name={record.employee.fullName} />
                ),
              },
              { label: "Source", value: attendanceSourceLabels[record.source] },
              { label: "Notes", value: orDash(record.notes) },
            ]}
          />
        </section>

        {record.capabilities.canEdit ? (
          <div className="lg:col-span-2">
            <AttendanceForm
              action={action}
              lockedDate={{
                date: formatDate(record.date),
                employee: record.employee.fullName,
              }}
              values={{
                employeeId: record.employee.employeeId,
                date: record.date,
                status: record.status,
                checkIn: record.checkIn,
                checkOut: record.checkOut,
                notes: record.notes,
              }}
              versionUpdatedAt={record.updatedAt}
              cancelHref="/hr/attendance"
              submitLabel="Save day"
              pendingLabel="Saving…"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
