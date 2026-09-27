import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";

import { ModulePage } from "@/components/modules/module-page";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { listGroupDepartments, listOrganizationCompanies } from "@/lib/modules/organization/departments/department.query";
import { getOrganizationOverview, type PersonRefDTO } from "@/lib/modules/organization/organization.service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("organization"))("overview.metaTitle") };
}

function names(people: PersonRefDTO[]): ReactNode {
  return people.length === 0
    ? "—"
    : people.map((person, index) => (
        <Fragment key={person.userId}>
          {index > 0 ? ", " : null}
          <PersonLink userId={person.userId} name={person.name} />
        </Fragment>
      ));
}

export default async function OrganizationPage() {
  const context = await requireModule("organization");
  const experience = resolveModuleExperience(context, "organization");
  const t = await getTranslations("organization");
  const overview = await getOrganizationOverview(context);
  // How far the departments are set up, within the reader's reach (E-13 §97).
  const metrics = can(context, "organization.department.view")
    ? await Promise.all([listGroupDepartments(memberActor(context)), listOrganizationCompanies(memberActor(context))]).then(([departments, companies]) => [
        { label: t("overview.groupDepartments"), value: departments.length },
        { label: t("overview.activeCompanyDepartments"), value: companies.reduce((sum, company) => sum + company.activeDepartments, 0) },
        { label: t("overview.withoutHead"), value: departments.filter((department) => department.activeCompanyCount > 0 && !department.groupHead).length },
        { label: t("overview.withoutManager"), value: companies.reduce((sum, company) => sum + company.activeDepartments - company.withManager, 0) },
      ])
    : null;

  return (
    <ModulePage experience={experience} activeSection="overview">
      <div className="space-y-5">
        {metrics ? (
          <section aria-label={t("overview.atAGlance")} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="nesto-card p-4" data-testid="department-metric">
                <p className="text-meta text-fg-subtle">{metric.label}</p>
                <p className="text-section font-semibold tabular-nums text-fg">{metric.value}</p>
              </div>
            ))}
          </section>
        ) : null}
        <section className="nesto-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-meta text-fg-subtle">{t("overview.parentGroup")}</p>
              <h2 className="text-section font-semibold text-fg">{overview.parentGroup.name}</h2>
            </div>
            <StatusBadge status={overview.parentGroup.status} />
          </div>
        </section>

        <section className="nesto-card p-5" aria-labelledby="organization-companies">
          <h2 id="organization-companies" className="text-card font-semibold text-fg">
            {overview.reach === "GROUP" ? t("overview.companiesInGroup") : t("overview.yourCompany")}
          </h2>
          <ul className="mt-3 divide-y divide-line">
            {overview.companies.map((company) => (
              <li key={company.id} className="flex items-center justify-between gap-3 py-3">
                <span className="text-table font-medium text-fg">
                  {company.name}
                  {company.isCurrent ? <span className="ml-2 text-meta text-fg-subtle">{t("overview.current")}</span> : null}
                </span>
                <StatusBadge status={company.status} />
              </li>
            ))}
          </ul>
        </section>

        {overview.departments ? (
          <section className="nesto-card p-5" aria-labelledby="organization-departments">
            <h2 id="organization-departments" className="text-card font-semibold text-fg">
              {t("common.departments")}
            </h2>
            <Table flush className="mt-3" aria-labelledby="organization-departments">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t("overview.groupDepartment")}</TableHeaderCell>
                  <TableHeaderCell>{t("overview.groupHead")}</TableHeaderCell>
                  <TableHeaderCell>{t("overview.inCompany", { company: context.company.name })}</TableHeaderCell>
                  <TableHeaderCell>{t("common.manager")}</TableHeaderCell>
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
