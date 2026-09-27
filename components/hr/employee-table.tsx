import { DataTable, type TableColumn } from "@/components/data/data-table";
import type { TableSortConfig } from "@/components/data/sort-header";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { getTranslations } from "@/lib/i18n/server";
import { hrLabel } from "./hr-labels";
import type { EmployeeSummaryDTO } from "@/lib/modules/hr/hr.types";
import { formatDate, orDash } from "@/lib/utils/format";

/**
 * The employee list (PRD #16 §40).
 *
 * Employment facts only. Compensation is deliberately absent: it is not part of
 * an employee DTO at all, so no column here could show it even by accident
 * (PRD #16 §40, §169).
 */
export async function EmployeeTable({ employees, listId = "hr.employees", sort }: {
  employees: EmployeeSummaryDTO[];
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
  /** The list's parsed sort and allowlist; header sorts only where the page reads the `sort` they write (AUD-08 §4). */
  sort?: TableSortConfig;
}) {
  const t = await getTranslations("hr");
  const columns: TableColumn<EmployeeSummaryDTO>[] = [
    {
      key: "employee",
      id: "employee",
      mandatory: true,
      sortKey: sort ? "name" : undefined,
      label: t("columns.employee"),
      primary: true,
      render: (employee) => (
        <span className="min-w-0">
          <span className="block truncate">{employee.name.fullName}</span>
          <span className="block truncate text-meta font-normal text-fg-subtle">
            {orDash(employee.jobTitle)}
          </span>
        </span>
      ),
    },
    {
      key: "work",
      id: "work",
      label: t("columns.categoryTrade"),
      hideBelow: "lg",
      render: (employee) => (
        <span className="text-fg-muted">
          {[employee.workerCategory ? hrLabel(t, "workerCategory", employee.workerCategory) : null, employee.trade?.name].filter(Boolean).join(" · ") || "—"}
        </span>
      ),
    },
    {
      key: "employeeNumber",
      id: "employeeNumber",
      label: t("columns.employeeNo"),
      hideBelow: "xl",
      render: (employee) => (
        <span className="text-fg-muted tabular-nums">{orDash(employee.employeeNumber)}</span>
      ),
    },
    {
      key: "department",
      id: "department",
      label: t("columns.department"),
      hideBelow: "lg",
      render: (employee) => (
        <span className="text-fg-muted">{orDash(employee.department?.name)}</span>
      ),
    },
    {
      key: "manager",
      id: "manager",
      label: t("columns.manager"),
      hideBelow: "xl",
      render: (employee) => (
        <span className="text-fg-muted">
          {employee.manager ? <PersonLink memberId={employee.manager.memberId} name={employee.manager.fullName} /> : "—"}
        </span>
      ),
    },
    {
      key: "employmentType",
      id: "employmentType",
      label: t("columns.type"),
      hideBelow: "md",
      render: (employee) => (
        <span className="text-fg-muted">{hrLabel(t, "employmentType", employee.employmentType)}</span>
      ),
    },
    {
      key: "status",
      id: "status",
      mandatory: true,
      valueType: "status",
      label: t("columns.status"),
      render: (employee) => <StatusBadge status={employee.employmentStatus} />,
    },
    {
      key: "account",
      id: "account",
      valueType: "status",
      label: t("columns.nestoAccount"),
      hideBelow: "md",
      render: (employee) => (
        <span className={employee.accountStatus === "HAS_ACCOUNT" ? "text-fg-muted" : "text-fg-subtle"}>
          {employee.accountStatus === "HAS_ACCOUNT" ? t("common.yes") : hrLabel(t, "accountStatus", employee.accountStatus)}
        </span>
      ),
    },
    {
      key: "startDate",
      id: "startDate",
      valueType: "date",
      sortKey: sort ? "start" : undefined,
      label: t("columns.started"),
      hideBelow: "lg",
      render: (employee) => (
        <span className="text-fg-muted">
          {employee.startDate ? formatDate(employee.startDate) : "—"}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={t("meta.employees")}
      columns={columns}
      records={employees}
      rowKey={(employee) => employee.id}
      rowHref={(employee) => `/hr/employees/${employee.id}`}
    />
  );
}
