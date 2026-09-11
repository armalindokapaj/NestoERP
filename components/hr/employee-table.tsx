import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { employmentTypeLabels } from "@/lib/modules/hr/hr.status";
import type { EmployeeSummaryDTO } from "@/lib/modules/hr/hr.types";
import { formatDate, orDash } from "@/lib/utils/format";

/**
 * The employee list (PRD #16 §40).
 *
 * Employment facts only. Compensation is deliberately absent: it is not part of
 * an employee DTO at all, so no column here could show it even by accident
 * (PRD #16 §40, §169).
 */
export function EmployeeTable({ employees }: { employees: EmployeeSummaryDTO[] }) {
  const columns: TableColumn<EmployeeSummaryDTO>[] = [
    {
      key: "employee",
      label: "Employee",
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
      key: "employeeNumber",
      label: "Employee no.",
      hideBelow: "xl",
      render: (employee) => (
        <span className="text-fg-muted tabular-nums">{orDash(employee.employeeNumber)}</span>
      ),
    },
    {
      key: "department",
      label: "Department",
      hideBelow: "lg",
      render: (employee) => (
        <span className="text-fg-muted">{orDash(employee.department?.name)}</span>
      ),
    },
    {
      key: "manager",
      label: "Manager",
      hideBelow: "xl",
      render: (employee) => (
        <span className="text-fg-muted">{orDash(employee.manager?.fullName)}</span>
      ),
    },
    {
      key: "employmentType",
      label: "Type",
      hideBelow: "md",
      render: (employee) => (
        <span className="text-fg-muted">{employmentTypeLabels[employee.employmentType]}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (employee) => <StatusBadge status={employee.employmentStatus} />,
    },
    {
      key: "startDate",
      label: "Started",
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
      caption="Employees"
      columns={columns}
      records={employees}
      rowKey={(employee) => employee.id}
      rowHref={(employee) => `/hr/employees/${employee.memberId}`}
    />
  );
}
