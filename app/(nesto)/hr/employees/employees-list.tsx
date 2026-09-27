import { UserRoundCog } from "lucide-react";
import { redirect } from "next/navigation";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { EmployeeTable } from "@/components/hr/employee-table";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { parseEmployeeQuery } from "@/lib/modules/hr/hr.query";
import { ACCOUNT_STATUSES } from "@/lib/modules/hr/hr.person";
import { EMPLOYEE_SORT_KEYS, EMPLOYMENT_TYPES, WORKER_CATEGORIES } from "@/lib/modules/hr/hr.schema";
import { employmentStatusLabels } from "@/lib/modules/hr/hr.status";
import { hrLabel } from "@/components/hr/hr-labels";
import { getTranslations } from "@/lib/i18n/server";
import { employeeFilterOptions } from "@/lib/modules/hr/employees/employee.repository";
import * as employees from "@/lib/modules/hr/employees/employee.service";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

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
  const t = await getTranslations("hr");

  const [result, options] = await Promise.all([
    employees.listEmployees(context, query),
    employeeFilterOptions(context),
  ]);

  const hasFilters = Boolean(
    query.search ||
      query.status?.length ||
      query.employmentType?.length ||
      query.departmentId ||
      query.managerMemberId ||
      query.accountStatus?.length ||
      query.workerCategory?.length ||
      query.tradeId,
  );

  const filters: FilterConfig[] = [
    {
      param: "status",
      label: t("columns.status"),
      options: Object.keys(employmentStatusLabels).map((value) => ({ value, label: hrLabel(t, "employmentStatus", value) })),
    },
    {
      param: "employmentType",
      label: t("columns.type"),
      options: EMPLOYMENT_TYPES.map((value) => ({
        value,
        label: hrLabel(t, "employmentType", value),
      })),
    },
    {
      param: "departmentId",
      label: t("columns.department"),
      options: options.departments.map((department) => ({
        value: department.id,
        label: department.name,
      })),
    },
    {
      param: "managerMemberId",
      label: t("columns.manager"),
      options: options.managers.map((manager) => ({ value: manager.id, label: manager.name })),
    },
    // Employment is not access: most site workers have no login, and HR finds them by that (E-04 §19).
    {
      param: "accountStatus",
      label: t("columns.nestoAccount"),
      options: ACCOUNT_STATUSES.map((value) => ({ value, label: hrLabel(t, "accountStatus", value) })),
    },
    {
      param: "workerCategory",
      label: t("columns.category"),
      options: WORKER_CATEGORIES.map((value) => ({ value, label: hrLabel(t, "workerCategory", value) })),
    },
    ...(options.trades.length > 0
      ? [{ param: "tradeId", label: t("columns.trade"), options: options.trades.map((trade) => ({ value: trade.id, label: trade.name })) }]
      : []),
  ];

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/hr/employees", searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref("/hr/employees", searchParams, page);

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={t("employees.searchPlaceholder")}
        filters={filters}
        sortOptions={[
          { value: "name-asc", label: t("employees.sort.nameAsc") },
          { value: "name-desc", label: t("employees.sort.nameDesc") },
          { value: "start-desc", label: t("employees.sort.startDesc") },
          { value: "start-asc", label: t("employees.sort.startAsc") },
          { value: "department-asc", label: t("columns.department") },
          { value: "status-asc", label: t("columns.status") },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<UserRoundCog />}
            title={t("employees.noMatchTitle")}
            description={t("common.adjustFilters")}
            action={{ label: t("common.clearFilters"), href: "/hr/employees" }}
          />
        ) : (
          <EmptyState
            icon={<UserRoundCog />}
            title={t("employees.emptyTitle")}
            description={t("employees.emptyDescription")}
            action={
              can(context, "hr.employee.create_profile")
                ? { label: t("employees.addRecord"), href: "/hr/employees/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <EmployeeTable employees={result.data} sort={{ value: query.sort, keys: EMPLOYEE_SORT_KEYS }} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
