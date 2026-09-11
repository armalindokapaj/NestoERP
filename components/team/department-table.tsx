import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { DepartmentActions } from "@/components/team/department-actions";
import type { DepartmentSummaryDTO } from "@/lib/modules/team/team.types";
import { orDash } from "@/lib/utils/format";

/**
 * Departments (PRD #14 §113, §114).
 *
 * A department is organisational metadata: it groups people and gives reports
 * something to slice by. Managing one grants no access of its own
 * (PRD #14 §120).
 */
export function DepartmentTable({
  departments,
  canUpdate,
  canArchive,
  canRestore,
}: {
  departments: DepartmentSummaryDTO[];
  canUpdate: boolean;
  canArchive: boolean;
  canRestore: boolean;
}) {
  const columns: TableColumn<DepartmentSummaryDTO>[] = [
    {
      key: "name",
      label: "Department",
      primary: true,
      render: (department) => (
        <span className="min-w-0">
          <span className="block truncate">{department.name}</span>
          {department.description ? (
            <span className="block truncate text-meta font-normal text-fg-subtle">
              {department.description}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "manager",
      label: "Manager",
      render: (department) =>
        department.manager ? (
          <span className="text-fg-muted">
            {department.manager.fullName}
            {/* A manager who has lost access is shown, not hidden: a stale org
                chart is worse than an awkward one (PRD #14 §248). */}
            {department.manager.active ? "" : " (no longer active)"}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "key",
      label: "Key",
      hideBelow: "xl",
      render: (department) => (
        <span className="font-mono text-meta text-fg-subtle">{orDash(department.key)}</span>
      ),
    },
    {
      key: "members",
      label: "Active members",
      align: "right",
      render: (department) => (
        <span className="tabular-nums text-fg-muted">{department.activeMembers}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (department) => <StatusBadge status={department.status} />,
    },
  ];

  const showActions = canUpdate || canArchive || canRestore;

  return (
    <DataTable
      caption="Departments"
      columns={columns}
      records={departments}
      rowKey={(department) => department.id}
      actions={
        showActions
          ? (department) => (
              <DepartmentActions
                departmentId={department.id}
                name={department.name}
                archived={department.status === "ARCHIVED"}
                activeMembers={department.activeMembers}
                canUpdate={canUpdate}
                canArchive={canArchive}
                canRestore={canRestore}
              />
            )
          : undefined
      }
    />
  );
}
