import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CompensationHistory } from "@/components/hr/compensation-history";
import * as compensation from "@/lib/modules/hr/compensation/compensation.service";
import { loadEmployee } from "../../employee-context";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ employeeId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hr");
  return { title: t("meta.compensation") };
}

/**
 * Pay for one employee (PRD #16 §58, §240).
 *
 * Behind its own permission, on its own route, served by its own service. A
 * reader without `hr.compensation.view` never sees this tab at all rather than
 * a locked placeholder, because a placeholder still confirms that a salary is
 * on file (PRD #16 §317).
 */
export default async function CompensationTabPage({ params }: Params) {
  const { employeeId } = await params;
  const { context, employee } = await loadEmployee(employeeId, "/compensation");

  if (!employee.capabilities.canViewCompensation) notFound();

  const records = await compensation.listCompensation(context, employeeId);
  const t = await getTranslations("hr");

  return (
    <div className="space-y-5">
      <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
        {t("compensation.confidential")}
      </p>

      <CompensationHistory records={records} />
    </div>
  );
}
