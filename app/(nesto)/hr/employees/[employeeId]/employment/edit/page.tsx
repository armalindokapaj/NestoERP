import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EmploymentForm } from "@/components/hr/employment-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { updateEmployeeProfileAction } from "@/lib/actions/hr";
import { tradeOptions } from "@/lib/modules/hr/employees/employee.repository";
import { employeeBreadcrumbs, loadEmployee } from "../../employee-context";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ employeeId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hr");
  return { title: t("meta.editDetails") };
}

/**
 * Edit what of an employment record is not history (PRD #16 §50; E-03 §37,
 * §187; E-04 §156): its number, probation, planned end, hours, worker category
 * and trade. Where somebody sits and
 * their status are dated changes, made from the record header.
 */
export default async function EditEmploymentPage({ params }: Params) {
  const { employeeId } = await params;
  const { context, employee } = await loadEmployee(employeeId, "/employment/edit");
  const trades = await tradeOptions(context, employee.trade?.id ?? null);

  if (!employee.capabilities.canEditEmployment) redirect(`/hr/employees/${employeeId}`);
  const t = await getTranslations("hr");

  async function action(formData: FormData) {
    "use server";
    return updateEmployeeProfileAction(employeeId, formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={await employeeBreadcrumbs(employee, t("meta.editDetails"))}
        title={t("employment.editTitle", { name: employee.name.fullName })}
        status={employee.employmentStatus}
      />

      <EmploymentForm
        action={action}
        values={{
          employeeNumber: employee.employeeNumber,
          probationEndDate: employee.probationEndDate,
          endDate: employee.endDate,
          weeklyHours: employee.weeklyHours,
          workerCategory: employee.workerCategory,
          tradeId: employee.trade?.id ?? null,
        }}
        trades={trades.map((trade) => ({ value: trade.id, label: trade.isActive ? trade.name : t("employment.retiredTrade", { name: trade.name }) }))}
        memberId={employee.memberId}
        versionUpdatedAt={employee.updatedAt}
        cancelHref={`/hr/employees/${employeeId}/employment`}
        submitLabel={t("common.saveChanges")}
        pendingLabel={t("common.saving")}
      />
    </div>
  );
}
