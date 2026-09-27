import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { ModulePage } from "@/components/modules/module-page";
import { StatusBadge } from "@/components/modules/status-badge";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { listOrganizationCompanies } from "@/lib/modules/organization/departments/department.query";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("organization"))("common.companies") };
}

type Row = Awaited<ReturnType<typeof listOrganizationCompanies>>[number];

/**
 * Organization → Companies (E-13 §7, §96): each company the reader may see, and
 * how far its departments are set up — which are active, how many have a
 * manager, how many people work in them.
 */
export default async function CompaniesPage() {
  const context = await requireModule("organization");
  if (!can(context, "organization.department.view")) redirect("/access-denied");
  const companies = await listOrganizationCompanies(memberActor(context));
  const t = await getTranslations("organization");

  const columns: TableColumn<Row>[] = [
    {
      key: "name",
      id: "name",
      mandatory: true,
      label: t("common.company"),
      primary: true,
      render: (company) => (
        <Link href={`/organization/companies/${company.id}`} className="font-medium text-fg hover:text-accent-strong hover:underline">
          {company.name}
        </Link>
      ),
    },
    { key: "departments", label: t("companies.activeDepartments"), align: "right", render: (company) => <span className="tabular-nums">{company.activeDepartments}</span> },
    {
      key: "managers",
      id: "managers",
      label: t("companies.withManager"),
      align: "right",
      render: (company) => <span className="tabular-nums">{company.activeDepartments === 0 ? "—" : t("companies.managersOf", { count: company.withManager, total: company.activeDepartments })}</span>,
    },
    { key: "people", label: t("companies.peopleInDepartments"), align: "right", hideBelow: "lg", render: (company) => <span className="tabular-nums">{company.people}</span> },
    { key: "status", label: t("common.status"), render: (company) => <StatusBadge status={company.status} /> },
  ];

  return (
    <ModulePage experience={resolveModuleExperience(context, "organization")} activeSection="companies" title={t("common.companies")} description={t("companies.description")}>
      <DataTable listId="organization.companies" caption={t("common.companies")} columns={columns} records={companies} rowKey={(company) => company.id} />
    </ModulePage>
  );
}
