import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmployeeTabs } from "@/components/hr/employee-tabs";
import { HrRecordDocuments } from "@/components/hr/record-documents";
import { RecordContextHeader } from "@/components/modules/record-header";
import { orDash } from "@/lib/utils/format";
import { employeeBreadcrumbs, employeeTabVisibility, loadEmployee } from "../employee-context";

type Params = { params: Promise<{ employeeId: string }> };

export const metadata: Metadata = { title: "Employee documents" };

/**
 * The employment file (PRD #16 §133, §135).
 *
 * Reached with `hr.document.view` plus `hr.employee.view` — or, for one's own
 * record only, `hr.self.documents`. Both doors are decided by the parent-access
 * resolver, not here (PRD #16 §204).
 */
export default async function EmployeeDocumentsTabPage({ params }: Params) {
  const { employeeId } = await params;
  const { context, employee } = await loadEmployee(employeeId, "/documents");

  if (!employee.capabilities.canViewDocuments) notFound();

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={employeeBreadcrumbs(employee, "Documents")}
        title={employee.name.fullName}
        subtitle={orDash(employee.jobTitle)}
        status={employee.employmentStatus}
      />

      <EmployeeTabs
        employeeId={employee.id}
        active="documents"
        show={employeeTabVisibility(employee)}
      />

      <HrRecordDocuments
        context={context}
        entityType="employee"
        entityId={employee.id}
        canAttach={employee.employmentStatus !== "ENDED"}
        emptyDescription="Contracts, identification and certificates filed against this employment record appear here."
      />
    </div>
  );
}
