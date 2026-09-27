import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound, redirect } from "next/navigation";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { AppointButton, BranchStatusButton, EndAssignmentButton, type CandidateOption } from "@/components/organization/department-actions";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { getCompanyDepartments, listDepartmentCandidates } from "@/lib/modules/organization/departments/department.query";
import type { CompanyDepartmentsDTO } from "@/lib/modules/organization/departments/department.types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("organization"))("company.metaTitle") };
}

type Props = { params: Promise<{ companyId: string }> };
type Row = CompanyDepartmentsDTO["rows"][number];

const API = { base: "/api/organization", platform: false };

/**
 * Company → Departments (E-13 §39, §98): every department of the group as this
 * company runs it. A department is activated here, never created: it is defined
 * once for the group (§3, §39). Readable without switching company (§86).
 */
export default async function CompanyDepartmentsPage({ params }: Props) {
  const { companyId } = await params;
  const context = await requireModule("organization");
  if (!can(context, "organization.department.view")) redirect("/access-denied");
  const view = await getCompanyDepartments(memberActor(context), companyId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  const t = await getTranslations("organization");
  const managerOptions = new Map<string, CandidateOption[]>();
  for (const row of view.rows.filter((candidate) => candidate.canAppointManager)) {
    const candidates = await listDepartmentCandidates(memberActor(context), row.department.id, { position: "COMPANY_MANAGER", company: view.company.id, search: undefined });
    managerOptions.set(row.department.id, candidates.filter((candidate) => candidate.eligible && candidate.personId).map((candidate) => ({ personId: candidate.personId!, label: [candidate.name, candidate.jobTitle].filter(Boolean).join(" · ") })));
  }
  const departmentHref = (row: Row) => `/organization/departments/${encodeURIComponent(row.department.id)}`;

  const columns: TableColumn<Row>[] = [
    {
      key: "department",
      id: "department",
      mandatory: true,
      label: t("common.department"),
      primary: true,
      render: (row) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <Link href={departmentHref(row)} className="font-medium text-fg hover:text-accent-strong hover:underline">
            {row.department.name}
          </Link>
          <Badge tone="default">{row.department.code}</Badge>
        </span>
      ),
    },
    {
      key: "manager",
      id: "manager",
      label: t("common.manager"),
      render: (row) => {
        if (!row.branch) return <span className="text-meta text-fg-subtle">{t("company.notActive", { department: row.department.name })}</span>;
        const manager = row.branch.manager;
        return (
          <div className="flex flex-wrap items-center gap-2">
            {manager ? (
              <PersonLink personId={manager.personId} name={manager.name} />
            ) : (
              <span className="text-fg-subtle">{t("company.noManager")}</span>
            )}
            {manager && row.canAppointManager ? <EndAssignmentButton assignmentId={manager.assignmentId} personName={manager.name} what={t("company.managerOf", { department: row.department.name })} /> : null}
            {row.canAppointManager ? (
              <AppointButton api={API} target={{ kind: "manager", branchId: row.branch.id }} title={t(manager ? "company.replaceManager" : "company.assignManager", { department: row.department.name, company: view.company.name })} holder={manager?.name ?? null} candidates={managerOptions.get(row.department.id) ?? []} />
            ) : null}
          </div>
        );
      },
    },
    { key: "members", label: t("common.people"), align: "right", render: (row) => <span className="tabular-nums">{row.branch?.memberCount ?? "—"}</span> },
    {
      key: "status",
      id: "status",
      valueType: "status",
      label: t("common.status"),
      render: (row) => (row.branch ? <StatusBadge status={row.branch.status} /> : <span className="text-meta text-fg-subtle">{t("company.notActiveShort")}</span>),
    },
  ];

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: t("common.organization"), href: "/organization" }, { label: t("common.companies"), href: "/organization/companies" }, { label: view.company.name }]} />
      <div>
        <h1 className="text-page font-semibold text-fg">{view.company.name}</h1>
        <p className="mt-1 text-body text-fg-muted">{t("company.description")}</p>
      </div>
      {view.rows.length === 0 ? (
        <EmptyState title={t("common.noGroupDepartments")} description={t("company.emptyDescription")} />
      ) : (
        <DataTable
      listId="organization.company-departments"
          caption={t("company.caption", { company: view.company.name })}
          columns={columns}
          records={view.rows}
          rowKey={(row) => row.department.id}
          actions={(row) => (
            <div className="flex flex-wrap items-center justify-end gap-1">
              {row.canActivate ? <BranchStatusButton api={API} department={row.department} company={view.company} status={row.branch?.status ?? null} /> : null}
              {row.branch ? (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`${departmentHref(row)}?tab=team&company=${view.company.id}`}>{t("common.viewTeam")}</Link>
                </Button>
              ) : null}
            </div>
          )}
        />
      )}
    </div>
  );
}
