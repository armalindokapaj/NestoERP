import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AttendanceForm } from "@/components/hr/attendance-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { createAttendanceAction } from "@/lib/actions/hr";
import { requireModule } from "@/lib/context/current-user";
import { committed } from "@/lib/forms/committed";
import { listEmployees } from "@/lib/modules/hr/employees/employee.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hr");
  return { title: t("meta.recordAttendance") };
}

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

  const t = await getTranslations("hr");
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
    // Answered, not redirected: the form learns the save committed (AUD-03 §6).
    return committed(result.id ? `/hr/attendance/${result.id}` : "/hr/attendance");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: t("meta.hr"), href: "/hr" },
          { label: t("meta.attendance"), href: "/hr/attendance" },
          { label: t("attendance.recordDay") },
        ]}
        title={t("meta.recordAttendance")}
        subtitle={t("attendance.newSubtitle")}
      />

      <AttendanceForm
        action={action}
        employees={
          employees
            ? employees.data.map((employee) => ({
                value: employee.id,
                label: employee.accountStatus === "NO_ACCOUNT" ? t("leave.noAccountName", { name: employee.name.fullName }) : employee.name.fullName,
              }))
            : undefined
        }
        cancelHref="/hr/attendance"
        submitLabel={t("attendance.recordDaySubmit")}
        pendingLabel={t("attendance.recording")}
      />
    </div>
  );
}
