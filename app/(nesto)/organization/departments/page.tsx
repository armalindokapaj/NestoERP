import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
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
import { getTranslations } from "@/lib/i18n/server";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { listGroupDepartments } from "@/lib/modules/organization/departments/department.query";
import type { GroupDepartmentDTO } from "@/lib/modules/organization/departments/department.types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("organization"))("common.departments") };
}

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

  const t = await getTranslations("organization");
  const columns: TableColumn<GroupDepartmentDTO>[] = [
    {
      key: "name",
      id: "name",
      mandatory: true,
      label: t("common.department"),
      primary: true,
      render: (department) => (
        <Link href={`/organization/departments/${encodeURIComponent(department.id)}`} className="font-medium text-fg hover:text-accent-strong hover:underline">
          {department.name}
        </Link>
      ),
    },
    { key: "code", label: t("departments.code"), render: (department) => <span className="font-mono text-meta text-fg-muted">{department.code}</span> },
    { key: "head", label: t("departments.groupHead"), render: (department) => (department.groupHead ? <PersonLink personId={department.groupHead.personId} name={department.groupHead.name} /> : <span className="text-fg-subtle">{t("departments.noHead")}</span>) },
    { key: "companies", label: t("departments.activeCompanies"), align: "right", render: (department) => <span className="tabular-nums">{department.activeCompanyCount}</span> },
    { key: "members", label: t("common.people"), align: "right", hideBelow: "lg", render: (department) => <span className="tabular-nums">{department.memberCount}</span> },
    { key: "status", label: t("common.status"), render: (department) => <StatusBadge status={department.status} /> },
  ];

  return (
    <ModulePage
      experience={resolveModuleExperience(context, "organization")}
      activeSection="departments"
      title={t("common.departments")}
      description={t("departments.description", { group: context.parentGroup.name })}
      actions={
        configures ? (
          <div className="flex items-center gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href={showInactive ? "/organization/departments" : "/organization/departments?inactive=1"}>{showInactive ? t("departments.hideInactive") : t("departments.showInactive")}</Link>
            </Button>
            <NewDepartmentButton api={ORGANIZATION_API} />
          </div>
        ) : null
      }
    >
      {departments.length === 0 ? (
        <EmptyState
          icon={<Network />}
          title={t("common.noGroupDepartments")}
          description={configures ? t("departments.emptyConfigures") : t("departments.emptyReads")}
        />
      ) : (
        <DataTable listId="organization.departments" caption={t("departments.caption")} columns={columns} records={departments} rowKey={(department) => department.id} />
      )}
    </ModulePage>
  );
}
