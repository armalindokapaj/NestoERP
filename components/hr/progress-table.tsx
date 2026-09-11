import { DataTable, type TableColumn } from "@/components/data/data-table";
import { ProgressActions } from "@/components/hr/progress-actions";
import { StatusBadge } from "@/components/modules/status-badge";
import type { ProgressKind, ProgressRow } from "@/lib/modules/hr/employees/progress.service";
import { formatDate, orDash } from "@/lib/utils/format";

/** The onboarding and offboarding lists (PRD #16 §120, §125). */
export function ProgressTable({
  rows,
  kind,
  dateLabel,
  canManage,
}: {
  rows: ProgressRow[];
  kind: ProgressKind;
  dateLabel: string;
  canManage: boolean;
}) {
  const columns: TableColumn<ProgressRow>[] = [
    {
      key: "employee",
      label: "Employee",
      primary: true,
      render: (row) => <span className="min-w-0 truncate">{row.fullName}</span>,
    },
    {
      key: "department",
      label: "Department",
      hideBelow: "lg",
      render: (row) => <span className="text-fg-muted">{orDash(row.department)}</span>,
    },
    {
      key: "manager",
      label: "Manager",
      hideBelow: "xl",
      render: (row) => <span className="text-fg-muted">{orDash(row.manager)}</span>,
    },
    {
      key: "date",
      label: dateLabel,
      render: (row) => (
        <span className="text-fg-muted">{row.date ? formatDate(row.date) : "—"}</span>
      ),
    },
    {
      key: "employmentStatus",
      label: "Employment",
      hideBelow: "md",
      render: (row) => <StatusBadge status={row.employmentStatus} />,
    },
    {
      key: "progress",
      label: kind === "onboarding" ? "Onboarding" : "Offboarding",
      render: (row) => <StatusBadge status={row.progress} />,
    },
  ];

  return (
    <DataTable
      caption={kind === "onboarding" ? "Onboarding" : "Offboarding"}
      columns={columns}
      records={rows}
      rowKey={(row) => row.memberId}
      rowHref={(row) => `/hr/employees/${row.memberId}`}
      actions={
        canManage
          ? (row) => (
              <ProgressActions
                memberId={row.memberId}
                kind={kind}
                current={row.progress}
                name={row.fullName}
              />
            )
          : undefined
      }
    />
  );
}
