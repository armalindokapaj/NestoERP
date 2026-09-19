import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Network } from "lucide-react";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { ModulePage } from "@/components/modules/module-page";
import { StatusBadge } from "@/components/modules/status-badge";
import { NewDepartmentButton } from "@/components/organization/department-actions";
import { PersonLink } from "@/components/people/person-link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { listGroupDepartments } from "@/lib/modules/organization/departments/department.query";
import type { GroupDepartmentDTO } from "@/lib/modules/organization/departments/department.types";

export const metadata: Metadata = { title: "Departments" };

type Props = { searchParams: Promise<{ inactive?: string }> };

const ORGANIZATION_API = { base: "/api/organization", platform: false };

/**
 * Organization → Departments (E-13 §7, §32, §98): every department of the
 * group once, with its code, head, the companies it is active in, its people
 * and its status. Those who configure the departments create them here and see
 * the inactive ones.
 */
export default async function DepartmentsPage({ searchParams }: Props) {
  const context = await requireModule("organization");
  if (!can(context, "organization.department.view")) redirect("/access-denied");
  const configures = can(context, "organization.department.manage");
  const showInactive = configures && (await searchParams).inactive === "1";
  const departments = await listGroupDepartments(memberActor(context), { status: showInactive ? "ALL" : "ACTIVE" });

  const columns: TableColumn<GroupDepartmentDTO>[] = [
    {
      key: "name",
      label: "Department",
      primary: true,
      render: (department) => (
        <Link href={`/organization/departments/${encodeURIComponent(department.id)}`} className="font-medium text-fg hover:text-accent-strong hover:underline">
          {department.name}
        </Link>
      ),
    },
    { key: "code", label: "Code", render: (department) => <span className="font-mono text-meta text-fg-muted">{department.code}</span> },
    { key: "head", label: "Group head", render: (department) => (department.groupHead ? <PersonLink personId={department.groupHead.personId} name={department.groupHead.name} /> : <span className="text-fg-subtle">No head</span>) },
    { key: "companies", label: "Active companies", align: "right", render: (department) => <span className="tabular-nums">{department.activeCompanyCount}</span> },
    { key: "members", label: "People", align: "right", hideBelow: "lg", render: (department) => <span className="tabular-nums">{department.memberCount}</span> },
    { key: "status", label: "Status", render: (department) => <StatusBadge status={department.status} /> },
  ];

  return (
    <ModulePage
      experience={resolveModuleExperience(context, "organization")}
      activeSection="departments"
      title="Departments"
      description={`Every department of ${context.parentGroup.name}, defined once and activated in the companies that need it.`}
      actions={
        configures ? (
          <div className="flex items-center gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href={showInactive ? "/organization/departments" : "/organization/departments?inactive=1"}>{showInactive ? "Hide inactive" : "Show inactive"}</Link>
            </Button>
            <NewDepartmentButton api={ORGANIZATION_API} />
          </div>
        ) : null
      }
    >
      {departments.length === 0 ? (
        <EmptyState
          icon={<Network />}
          title="No Group Departments have been created yet."
          description={configures ? "Create the group's first department, then activate it in the companies that need it." : "The group's departments are set up by its Owner and Group IT."}
        />
      ) : (
        <DataTable caption="Group departments" columns={columns} records={departments} rowKey={(department) => department.id} />
      )}
    </ModulePage>
  );
}
