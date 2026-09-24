import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { Crumb } from "@/components/ui/breadcrumbs";

import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as employees from "@/lib/modules/hr/employees/employee.service";
import type { EmployeeDetailDTO } from "@/lib/modules/hr/hr.types";

/**
 * Loads an employment record for every page under /hr/employees/[employeeId].
 *
 * Addressed by the employment, which every employee has — with a login or
 * without one (E-04 §7, §14). A link still written with a membership id, from
 * before, is sent on to the employment it names. A record outside the caller's
 * scope is a 404, not a 403, so the page cannot be used to discover that
 * somebody works here (PRD #16 §202).
 */
export const loadEmployee = cache(async function loadEmployee(
  employeeId: string,
  suffix = "",
): Promise<{ context: UserContext; employee: EmployeeDetailDTO }> {
  const context = await requireModule("hr");

  try {
    return { context, employee: await employees.getEmployee(context, employeeId) };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") {
      const employment = await employees.employmentIdForMember(context, employeeId);
      if (employment) redirect(`/hr/employees/${employment}${suffix}`);
      notFound();
    }
    throw error;
  }
});

export function employeeBreadcrumbs(employee: EmployeeDetailDTO, trailing?: string): Crumb[] {
  const crumbs: Crumb[] = [
    { label: "HR", href: "/hr" },
    { label: "Employees", href: "/hr/employees" },
    trailing
      ? { label: employee.name.fullName, href: `/hr/employees/${employee.id}` }
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
    history: employee.capabilities.canViewHistory,
  };
}
