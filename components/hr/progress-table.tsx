import { DataTable, type TableColumn } from "@/components/data/data-table";
import { ProgressActions } from "@/components/hr/progress-actions";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import type { ProgressKind, ProgressRow } from "@/lib/modules/hr/employees/progress.service";
import { formatDate, orDash } from "@/lib/utils/format";

/** The onboarding and offboarding lists (PRD #16 §120, §125). */
export function ProgressTable({
  rows,
  kind,
  dateLabel,
  canManage,
  total,
}: {
  rows: ProgressRow[];
  kind: ProgressKind;
  dateLabel: string;
  canManage: boolean;
  /** Every open record, when the worklist shows only the first of them (AUD-08 §4). */
  total?: number;
}) {
  const columns: TableColumn<ProgressRow>[] = [
    {
      key: "employee",
      id: "employee",
      mandatory: true,
      label: "Employee",
      primary: true,
      render: (row) => <span className="min-w-0 truncate">{row.fullName}</span>,
    },
    {
      key: "department",
      id: "department",
      label: "Department",
      hideBelow: "lg",
      render: (row) => <span className="text-fg-muted">{orDash(row.department)}</span>,
    },
    {
      key: "manager",
      id: "manager",
      label: "Manager",
      hideBelow: "xl",
      render: (row) => <span className="text-fg-muted">{row.manager ? <PersonLink memberId={row.managerMemberId} name={row.manager} /> : "—"}</span>,
    },
    {
      key: "date",
      id: "date",
      valueType: "date",
      label: dateLabel,
      render: (row) => (
        <span className="text-fg-muted">{row.date ? formatDate(row.date) : "—"}</span>
      ),
    },
    {
      key: "employmentStatus",
      id: "employmentStatus",
      valueType: "status",
      label: "Employment",
      hideBelow: "md",
      render: (row) => <StatusBadge status={row.employmentStatus} />,
    },
    {
      key: "progress",
      id: "progress",
      mandatory: true,
      valueType: "status",
      label: kind === "onboarding" ? "Onboarding" : "Offboarding",
      render: (row) => <StatusBadge status={row.progress} />,
    },
  ];

  return (
    <>
      {total !== undefined && total > rows.length ? (
        <p className="text-meta text-fg-subtle" data-testid="progress-scope">
          The first {rows.length} of {total}, soonest first.
        </p>
      ) : null}
      <DataTable
        listId={`hr.${kind}`}
        caption={kind === "onboarding" ? "Onboarding" : "Offboarding"}
        columns={columns}
        records={rows}
        rowKey={(row) => row.employeeId}
        rowHref={(row) => `/hr/employees/${row.employeeId}`}
        actions={
          canManage
            ? (row) => (
                <ProgressActions
                  employeeId={row.employeeId}
                  kind={kind}
                  current={row.progress}
                  name={row.fullName}
                />
              )
            : undefined
        }
      />
    </>
  );
}
