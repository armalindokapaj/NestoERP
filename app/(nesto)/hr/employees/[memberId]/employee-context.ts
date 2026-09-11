import { notFound } from "next/navigation";
import type { Crumb } from "@/components/ui/breadcrumbs";

import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as employees from "@/lib/modules/hr/employees/employee.service";
import type { EmployeeDetailDTO } from "@/lib/modules/hr/hr.types";

/**
 * Loads an employment record for every page under /hr/employees/[memberId].
 *
 * Addressed by membership id, the way every HR route is (PRD #16 §25). A record
 * outside the caller's scope is a 404, not a 403, so the page cannot be used to
 * discover that somebody works here (PRD #16 §202).
 */
export async function loadEmployee(
  memberId: string,
): Promise<{ context: UserContext; employee: EmployeeDetailDTO }> {
  const context = await requireModule("hr");

  try {
    return { context, employee: await employees.getEmployee(context, memberId) };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export function employeeBreadcrumbs(employee: EmployeeDetailDTO, trailing?: string): Crumb[] {
  const crumbs: Crumb[] = [
    { label: "HR", href: "/hr" },
    { label: "Employees", href: "/hr/employees" },
    trailing
      ? { label: employee.name.fullName, href: `/hr/employees/${employee.memberId}` }
      : { label: employee.name.fullName },
  ];
  if (trailing) crumbs.push({ label: trailing });
  return crumbs;
}

/** Which employee tabs this reader may open (PRD #16 §45). */
export function employeeTabVisibility(employee: EmployeeDetailDTO) {
  return {
    compensation: employee.capabilities.canViewCompensation,
    leave: employee.capabilities.canViewLeave,
    attendance: employee.capabilities.canViewAttendance,
    documents: employee.capabilities.canViewDocuments,
    activity: employee.capabilities.canViewActivity,
  };
}
