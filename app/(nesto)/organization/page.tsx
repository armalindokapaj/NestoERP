import type { Metadata } from "next";

import { ModulePage } from "@/components/modules/module-page";
import { StatusBadge } from "@/components/modules/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getOrganizationOverview, type PersonRefDTO } from "@/lib/modules/organization/organization.service";

export const metadata: Metadata = { title: "Organization" };

function names(people: PersonRefDTO[]): string {
  return people.length === 0 ? "—" : people.map((person) => person.name).join(", ");
}

export default async function OrganizationPage() {
  const context = await requireModule("organization");
  const experience = resolveModuleExperience(context, "organization");
  const overview = await getOrganizationOverview(context);

  return (
    <ModulePage experience={experience} activeSection="overview">
      <div className="space-y-5">
        <section className="nesto-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-meta text-fg-subtle">Parent group</p>
              <h2 className="text-section font-semibold text-fg">{overview.parentGroup.name}</h2>
            </div>
            <StatusBadge status={overview.parentGroup.status} />
          </div>
        </section>

        <section className="nesto-card p-5" aria-labelledby="organization-companies">
          <h2 id="organization-companies" className="text-card font-semibold text-fg">
            {overview.reach === "GROUP" ? "Companies in the group" : "Your company"}
          </h2>
          <ul className="mt-3 divide-y divide-line">
            {overview.companies.map((company) => (
              <li key={company.id} className="flex items-center justify-between gap-3 py-3">
                <span className="text-table font-medium text-fg">
                  {company.name}
                  {company.isCurrent ? <span className="ml-2 text-meta text-fg-subtle">(current)</span> : null}
                </span>
                <StatusBadge status={company.status} />
              </li>
            ))}
          </ul>
        </section>

        {overview.departments ? (
          <section className="nesto-card p-5" aria-labelledby="organization-departments">
            <h2 id="organization-departments" className="text-card font-semibold text-fg">
              Departments
            </h2>
            <Table flush className="mt-3" aria-labelledby="organization-departments">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Group department</TableHeaderCell>
                  <TableHeaderCell>Group head</TableHeaderCell>
                  <TableHeaderCell>In {context.company.name}</TableHeaderCell>
                  <TableHeaderCell>Manager</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {overview.departments.map((department) => (
                  <TableRow key={department.id}>
                    <TableCell className="font-medium">{department.name}</TableCell>
                    <TableCell>{names(department.heads)}</TableCell>
                    <TableCell>{department.branch?.name ?? "—"}</TableCell>
                    <TableCell>{department.branch ? names(department.branch.managers) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ) : null}
      </div>
    </ModulePage>
  );
}
