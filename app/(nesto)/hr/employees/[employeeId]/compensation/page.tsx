import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CompensationHistory } from "@/components/hr/compensation-history";
import { EmployeeTabs } from "@/components/hr/employee-tabs";
import { RecordContextHeader } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import * as compensation from "@/lib/modules/hr/compensation/compensation.service";
import { orDash } from "@/lib/utils/format";
import { employeeBreadcrumbs, employeeTabVisibility, loadEmployee } from "../employee-context";

type Params = { params: Promise<{ employeeId: string }> };

export const metadata: Metadata = { title: "Compensation" };

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

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={employeeBreadcrumbs(employee, "Compensation")}
        title={employee.name.fullName}
        subtitle={orDash(employee.jobTitle)}
        status={employee.employmentStatus}
        actions={
          employee.capabilities.canEditCompensation ? (
            <Button asChild size="sm">
              <Link href={`/hr/employees/${employeeId}/compensation/new`}>Record compensation</Link>
            </Button>
          ) : null
        }
      />

      <EmployeeTabs
        employeeId={employee.id}
        active="compensation"
        show={employeeTabVisibility(employee)}
      />

      <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
        Confidential. Amounts are never written into the activity trail, and are not part of any
        employee list or export without this permission.
      </p>

      <CompensationHistory records={records} />
    </div>
  );
}
