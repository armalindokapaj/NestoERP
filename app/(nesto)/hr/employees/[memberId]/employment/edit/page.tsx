import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EmploymentForm } from "@/components/hr/employment-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { updateEmployeeProfileAction } from "@/lib/actions/hr";
import { employeeBreadcrumbs, loadEmployee } from "../../employee-context";

type Params = { params: Promise<{ memberId: string }> };

export const metadata: Metadata = { title: "Edit details" };

/**
 * Edit what of an employment record is not history (PRD #16 §50; E-03 §37,
 * §187): its number, probation, planned end and hours. Where somebody sits and
 * their status are dated changes, made from the record header.
 */
export default async function EditEmploymentPage({ params }: Params) {
  const { memberId } = await params;
  const { employee } = await loadEmployee(memberId);

  if (!employee.capabilities.canEditEmployment) redirect(`/hr/employees/${memberId}`);

  async function action(formData: FormData) {
    "use server";
    return updateEmployeeProfileAction(memberId, formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={employeeBreadcrumbs(employee, "Edit details")}
        title={`Edit ${employee.name.fullName}’s details`}
        status={employee.employmentStatus}
      />

      <EmploymentForm
        action={action}
        values={{
          employeeNumber: employee.employeeNumber,
          probationEndDate: employee.probationEndDate,
          endDate: employee.endDate,
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
