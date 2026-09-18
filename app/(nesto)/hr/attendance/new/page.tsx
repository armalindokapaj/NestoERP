import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AttendanceForm } from "@/components/hr/attendance-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { createAttendanceAction } from "@/lib/actions/hr";
import { requireModule } from "@/lib/context/current-user";
import { listEmployees } from "@/lib/modules/hr/employees/employee.service";

export const metadata: Metadata = { title: "Record attendance" };

/**
 * Record a day of attendance (PRD #16 §102, §103).
 *
 * Recording somebody else's day needs `hr.attendance.create`; recording your
 * own needs only self-service, which is why the employee picker is absent
 * without the module grant.
 */
export default async function NewAttendancePage() {
  const context = await requireModule("hr");

  const forOthers = can(context, "hr.attendance.create");
  if (!forOthers && !can(context, "hr.self.attendance")) redirect("/access-denied");

  const employees =
    forOthers && can(context, "hr.employee.view")
      ? await listEmployees(context, {
          status: ["ACTIVE", "ON_LEAVE"],
          page: 1,
          limit: 100,
          sort: "name-asc",
        })
      : null;

  async function action(formData: FormData) {
    "use server";
    const result = await createAttendanceAction(formData);
    if (!result.ok) return result;
    redirect(result.id ? `/hr/attendance/${result.id}` : "/hr/attendance");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "HR", href: "/hr" },
          { label: "Attendance", href: "/hr/attendance" },
          { label: "Record a day" },
        ]}
        title="Record attendance"
        subtitle="One record per person per day. Worked hours are calculated from the times."
      />

      <AttendanceForm
        action={action}
        employees={
          employees
            ? employees.data.map((employee) => ({
                value: employee.id,
                label: employee.accountStatus === "NO_ACCOUNT" ? `${employee.name.fullName} (no NESTO account)` : employee.name.fullName,
              }))
            : undefined
        }
        cancelHref="/hr/attendance"
        submitLabel="Record day"
        pendingLabel="Recording…"
      />
    </div>
  );
}
