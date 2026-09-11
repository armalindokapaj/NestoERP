import { UserRoundCog } from "lucide-react";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { EmployeeTable } from "@/components/hr/employee-table";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { parseEmployeeQuery } from "@/lib/modules/hr/hr.query";
import { EMPLOYMENT_TYPES } from "@/lib/modules/hr/hr.schema";
import { employmentStatusLabels, employmentTypeLabels } from "@/lib/modules/hr/hr.status";
import { employeeFilterOptions } from "@/lib/modules/hr/employees/employee.repository";
import * as employees from "@/lib/modules/hr/employees/employee.service";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The employee list (PRD #16 §39–§44).
 *
 * Filter options are built from the employment records this reader can already
 * see, so a dropdown can never name a department or a manager they have no
 * access to (PRD #16 §207).
 */
export async function EmployeesList({
  context,
  searchParams,
}: {
  context: UserContext;
  searchParams: SearchParams;
}) {
  const query = parseEmployeeQuery(searchParams);

  const [result, options] = await Promise.all([
    employees.listEmployees(context, query),
    employeeFilterOptions(context),
  ]);

  const hasFilters = Boolean(
    query.search ||
      query.status?.length ||
      query.employmentType?.length ||
      query.departmentId ||
      query.managerMemberId,
  );

  const filters: FilterConfig[] = [
    {
      param: "status",
      label: "Status",
      options: Object.entries(employmentStatusLabels).map(([value, label]) => ({ value, label })),
    },
    {
      param: "employmentType",
      label: "Type",
      options: EMPLOYMENT_TYPES.map((value) => ({
        value,
        label: employmentTypeLabels[value],
      })),
    },
    {
      param: "departmentId",
      label: "Department",
      options: options.departments.map((department) => ({
        value: department.id,
        label: department.name,
      })),
    },
    {
      param: "managerMemberId",
      label: "Manager",
      options: options.managers.map((manager) => ({ value: manager.id, label: manager.name })),
    },
  ];

  function buildHref(page: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") params.set(key, value);
    }
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    return search ? `/hr/employees?${search}` : "/hr/employees";
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search name, email, number or job title…"
        filters={filters}
        sortOptions={[
          { value: "name-asc", label: "Name A–Z" },
          { value: "name-desc", label: "Name Z–A" },
          { value: "start-desc", label: "Recently started" },
          { value: "start-asc", label: "Longest serving" },
          { value: "department-asc", label: "Department" },
          { value: "status-asc", label: "Status" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<UserRoundCog />}
            title="No HR records match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: "/hr/employees" }}
          />
        ) : (
          <EmptyState
            icon={<UserRoundCog />}
            title="No employee profiles yet."
            description="An employment record is created for a team member who already has company access."
            action={
              can(context, "hr.employee.create_profile")
                ? { label: "Add employment record", href: "/hr/employees/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <EmployeeTable employees={result.data} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
