import Link from "@/components/navigation/nav-link";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import type { DepartmentSummaryDTO } from "@/lib/modules/team/team.types";
import { getTranslations } from "@/lib/i18n/server";
import { orDash } from "@/lib/utils/format";

/**
 * The company's departments (PRD #14 §113, §114; E-13 §39).
 *
 * Each is the company's branch of one of the group's departments. It is
 * activated, deactivated and given its manager from Organization, where a
 * branch of the group's department links to; here it is read.
 */
export async function DepartmentTable({ departments, linkToOrganization }: { departments: DepartmentSummaryDTO[]; linkToOrganization: boolean }) {
  const t = await getTranslations("team");
  const columns: TableColumn<DepartmentSummaryDTO>[] = [
    {
      key: "name",
      id: "name",
      mandatory: true,
      label: t("departments.department"),
      primary: true,
      render: (department) => (
        <span className="min-w-0">
          {linkToOrganization && department.groupDepartmentId ? (
            <Link href={`/organization/departments/${encodeURIComponent(department.groupDepartmentId)}`} className="block truncate hover:text-accent-strong hover:underline">
              {department.name}
            </Link>
          ) : (
            <span className="block truncate">{department.name}</span>
          )}
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
      id: "manager",
      label: t("departments.manager"),
      render: (department) =>
        department.manager ? (
          <span className="text-fg-muted">
            <PersonLink memberId={department.manager.memberId} name={department.manager.fullName} />
            {/* A manager who has lost access is shown, not hidden: a stale org
                chart is worse than an awkward one (PRD #14 §248). */}
            {department.manager.active ? "" : t("departments.noLongerActive")}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "code",
      id: "code",
      label: t("departments.code"),
      hideBelow: "xl",
      render: (department) => (
        <span className="font-mono text-meta text-fg-subtle">{orDash(department.code)}</span>
      ),
    },
    {
      key: "members",
      id: "members",
      valueType: "number",
      label: t("departments.activeMembers"),
      align: "right",
      render: (department) => (
        <span className="tabular-nums text-fg-muted">{department.activeMembers}</span>
      ),
    },
    {
      key: "status",
      id: "status",
      valueType: "status",
      label: t("departments.status"),
      render: (department) => <StatusBadge status={department.status} />,
    },
  ];

  return <DataTable listId="team.departments" caption={t("departments.caption")} columns={columns} records={departments} rowKey={(department) => department.id} />;
}
