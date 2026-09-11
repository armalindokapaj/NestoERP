import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EmploymentForm } from "@/components/hr/employment-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { updateEmployeeProfileAction } from "@/lib/actions/hr";
import { managerOptions } from "@/lib/modules/hr/employees/employee.repository";
import { employeeBreadcrumbs, loadEmployee } from "../../employee-context";

type Params = { params: Promise<{ memberId: string }> };

export const metadata: Metadata = { title: "Edit employment" };

/**
 * Edit an employment record (PRD #16 §50).
 *
 * Employment status is not a field here: it is a transition with rules, changed
 * from the record header (PRD #16 §54).
 */
export default async function EditEmploymentPage({ params }: Params) {
  const { memberId } = await params;
  const { context, employee } = await loadEmployee(memberId);

  if (!employee.capabilities.canEditEmployment) redirect(`/hr/employees/${memberId}`);

  const managers = await managerOptions(context);

  async function action(formData: FormData) {
    "use server";
    return updateEmployeeProfileAction(memberId, formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={employeeBreadcrumbs(employee, "Edit employment")}
        title={`Edit ${employee.name.fullName}`}
        status={employee.employmentStatus}
      />

      <EmploymentForm
        action={action}
        memberId={memberId}
        managers={managers.map((manager) => ({
          value: manager.id,
          label: `${manager.user.firstName} ${manager.user.lastName} — ${manager.role.name}`,
        }))}
        values={{
          employeeNumber: employee.employeeNumber,
          employmentType: employee.employmentType,
          startDate: employee.startDate,
          probationEndDate: employee.probationEndDate,
          endDate: employee.endDate,
          managerMemberId: employee.manager?.memberId ?? null,
          workLocation: employee.workLocation,
          weeklyHours: employee.weeklyHours,
        }}
        versionUpdatedAt={employee.updatedAt}
        cancelHref={`/hr/employees/${memberId}/employment`}
        submitLabel="Save changes"
        pendingLabel="Saving…"
      />
    </div>
  );
}
