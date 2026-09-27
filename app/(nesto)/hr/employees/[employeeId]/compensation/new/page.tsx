import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CompensationForm } from "@/components/hr/compensation-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { recordCompensationAction } from "@/lib/actions/hr";
import * as compensation from "@/lib/modules/hr/compensation/compensation.service";
import { employeeBreadcrumbs, loadEmployee } from "../../employee-context";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ employeeId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hr");
  return { title: t("meta.recordCompensation") };
}

/**
 * Record a new pay level (PRD #16 §65).
 *
 * There is no edit form: the record currently open is closed the day before
 * this one starts, in the same transaction, so an employee never has two open
 * salaries or none (PRD #16 §189).
 */
export default async function NewCompensationPage({ params }: Params) {
  const { employeeId } = await params;
  const { context, employee } = await loadEmployee(employeeId, "/compensation/new");

  if (!employee.capabilities.canEditCompensation) notFound();

  const history = await compensation.listCompensation(context, employeeId);
  const t = await getTranslations("hr");
  const current = history.find((record) => record.isCurrent) ?? null;

  async function action(formData: FormData) {
    "use server";
    return recordCompensationAction(employeeId, formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={await employeeBreadcrumbs(employee, t("meta.recordCompensation"))}
        title={t("compensation.titleFor", { name: employee.name.fullName })}
        status={employee.employmentStatus}
      />

      <CompensationForm
        action={action}
        currentAmount={
          current
            ? {
                baseAmount: current.baseAmount,
                currency: current.currency,
                payType: current.payType,
              }
            : null
        }
        cancelHref={`/hr/employees/${employeeId}/compensation`}
      />
    </div>
  );
}
