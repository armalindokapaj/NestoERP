import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { ModulePage } from "@/components/modules/module-page";
import { StatusBadge } from "@/components/modules/status-badge";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { listOrganizationCompanies } from "@/lib/modules/organization/departments/department.query";

export const metadata: Metadata = { title: "Companies" };

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

  const columns: TableColumn<Row>[] = [
    {
      key: "name",
      id: "name",
      mandatory: true,
      label: "Company",
      primary: true,
      render: (company) => (
        <Link href={`/organization/companies/${company.id}`} className="font-medium text-fg hover:text-accent-strong hover:underline">
          {company.name}
        </Link>
      ),
    },
    { key: "departments", label: "Active departments", align: "right", render: (company) => <span className="tabular-nums">{company.activeDepartments}</span> },
    {
      key: "managers",
      id: "managers",
      label: "With a manager",
      align: "right",
      render: (company) => <span className="tabular-nums">{company.activeDepartments === 0 ? "—" : `${company.withManager} of ${company.activeDepartments}`}</span>,
    },
    { key: "people", label: "People in departments", align: "right", hideBelow: "lg", render: (company) => <span className="tabular-nums">{company.people}</span> },
    { key: "status", label: "Status", render: (company) => <StatusBadge status={company.status} /> },
  ];

  return (
    <ModulePage experience={resolveModuleExperience(context, "organization")} activeSection="companies" title="Companies" description="The group's companies and the departments each one runs.">
      <DataTable listId="organization.companies" caption="Companies" columns={columns} records={companies} rowKey={(company) => company.id} />
    </ModulePage>
  );
}
