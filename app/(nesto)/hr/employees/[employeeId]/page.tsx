import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { EmploymentChanges } from "@/components/hr/employment-changes";
import { EmployeeTabs } from "@/components/hr/employee-tabs";
import { RequestAccountButton } from "@/components/hr/request-account";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink, membershipHref, personHref } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { todayDay } from "@/lib/modules/hr/employment/employment.dates";
import { workLocationTypeLabels } from "@/lib/modules/hr/employment/employment.labels";
import { employmentChangeOptions } from "@/lib/modules/hr/employment/employment.options";
import { accountStatusLabels, employmentTypeLabels, progressStatusLabels, workerCategoryLabels } from "@/lib/modules/hr/hr.status";
import { RECRUITABLE_ROLE_KEYS } from "@/lib/modules/hr/recruitment/candidate.schema";
import { roles } from "@/config/roles";
import type { RoleKey } from "@/config/roles";
import { formatDate, orDash } from "@/lib/utils/format";
import { employeeBreadcrumbs, employeeTabVisibility, loadEmployee } from "./employee-context";

type Params = { params: Promise<{ employeeId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { employeeId } = await params;
  try {
    const { employee } = await loadEmployee(employeeId);
    return { title: employee.name.fullName };
  } catch {
    return { title: "Employee" };
  }
}

/**
 * The employment record (PRD #16 §45–§48, E-04 §16, §21, §139).
 *
 * Safe employment facts only, for every employee — with a NESTO account or
 * without one. Pay is not on this page at all — it has its own tab, its own
 * service and its own permission (PRD #16 §48, §58).
 */
export default async function EmployeeDetailPage({ params }: Params) {
  const { employeeId } = await params;
  const { context, employee } = await loadEmployee(employeeId);
  const caps = employee.employment;
  const changes = Object.values(caps).some(Boolean) || employee.capabilities.canEditEmployment;
  const options = changes ? await employmentChangeOptions(context, employeeId) : { departments: [], managers: [], documents: [], companies: [] };

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={employeeBreadcrumbs(employee)}
        title={employee.name.fullName}
        subtitle={orDash(employee.jobTitle)}
        status={employee.employmentStatus}
        badges={<Badge tone="neutral">{employmentTypeLabels[employee.employmentType]}</Badge>}
        meta={[
          { label: "Department", value: orDash(employee.department?.name) },
          {
            label: "Manager",
            value: employee.manager ? (
              <PersonLink memberId={employee.manager.memberId} name={employee.manager.fullName} />
            ) : (
              "—"
            ),
          },
          {
            label: "Started",
            value: employee.startDate ? formatDate(employee.startDate) : "—",
          },
        ]}
        actions={<EmploymentChanges employee={employee} options={options} today={todayDay()} />}
      />

      <EmployeeTabs
        employeeId={employee.id}
        active="overview"
        show={employeeTabVisibility(employee)}
      />

      {employee.employmentStatus === "ENDED" && employee.memberId ? (
        employee.membershipStatus === "ACTIVE" ? (
          /*
           * Employment ended, company access did not (PRD #16 §230, §231).
           *
           * Said plainly, because this is the gap that matters: somebody who
           * has left can still sign in until a Team manager deactivates them.
           * HR does not do it automatically — that would make ending a contract
           * silently revoke access — so it is surfaced instead.
           */
          <p className="rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-table text-warning-strong">
            Employment ended{employee.endDate ? ` on ${formatDate(employee.endDate)}` : ""}, but
            this person still has active company access. Deactivating it is a{" "}
            <Link
              href={membershipHref(employee.memberId)}
              className="font-medium underline underline-offset-2"
            >
              Team action
            </Link>
            , taken deliberately by somebody who holds that permission.
          </p>
        ) : (
          <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
            Employment ended{employee.endDate ? ` on ${formatDate(employee.endDate)}` : ""}. Company
            access is separate and is managed in{" "}
            <Link href={membershipHref(employee.memberId)} className="text-accent-strong hover:underline">
              Team
            </Link>
            .
          </p>
        )
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">Employment</h2>
          <DetailGrid
            className="mt-4"
            columns={3}
            items={[
              { label: "Employee number", value: orDash(employee.employeeNumber) },
              { label: "Employment type", value: employmentTypeLabels[employee.employmentType] },
              { label: "Worker category", value: employee.workerCategory ? workerCategoryLabels[employee.workerCategory] : "—" },
              { label: "Trade", value: orDash(employee.trade?.name) },
              { label: "Department", value: orDash(employee.department?.name) },
              { label: "Job title", value: orDash(employee.jobTitle) },
              {
                label: "Start date",
                value: employee.startDate ? formatDate(employee.startDate) : "—",
              },
              {
                label: "Probation ends",
                value: employee.probationEndDate ? formatDate(employee.probationEndDate) : "—",
              },
              {
                label: "End date",
                value: employee.endDate ? formatDate(employee.endDate) : "—",
              },
              {
                label: "Work location",
                value: orDash([employee.workLocationType ? workLocationTypeLabels[employee.workLocationType] : null, employee.workLocation].filter(Boolean).join(", ")),
              },
              { label: "Weekly hours", value: orDash(employee.weeklyHours) },
            ]}
          />
          {employee.capabilities.canViewHistory ? (
            <p className="mt-4 border-t border-line pt-3 text-meta text-fg-subtle">
              How they got here — every position, department, manager and status, from its date — is in the{" "}
              <Link href={`/hr/employees/${employee.id}/history`} className="text-accent-strong hover:underline">
                employment history
              </Link>
              .
            </p>
          ) : null}
        </section>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Contact</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: "Work email", value: orDash(employee.email) },
                { label: "Phone", value: orDash(employee.phone) },
              ]}
            />
            <p className="mt-4 border-t border-line pt-3 text-meta text-fg-subtle">
              Contact details live on the{" "}
              <Link href={personHref({ personId: employee.personId })!} className="text-accent-strong hover:underline">
                person profile
              </Link>
              , not on the employment record.
            </p>
          </section>

          <section className="nesto-card p-5" aria-labelledby="account-heading" data-testid="employee-account">
            <h2 id="account-heading" className="text-card font-semibold text-fg">
              NESTO account
            </h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: "Account", value: accountStatusLabels[employee.accountStatus] },
                ...(employee.role ? [{ label: "Role", value: employee.role.name }] : []),
              ]}
            />
            <p className="mt-4 border-t border-line pt-3 text-meta text-fg-subtle">
              {employee.memberId ? (
                <>
                  Company access is managed on the{" "}
                  <Link href={membershipHref(employee.memberId)} className="text-accent-strong hover:underline">
                    team membership
                  </Link>
                  . Ending employment never removes it on its own.
                </>
              ) : (
                "Everything about this employee is recorded without a login: employment, pay, documents, attendance and where they work. A login, if one is ever needed, is linked to this same record."
              )}
            </p>
            {employee.capabilities.canRequestAccount ? (
              <div className="mt-3">
                <RequestAccountButton
                  employeeId={employee.id}
                  name={employee.name.fullName}
                  departmentId={employee.department?.id ?? null}
                  departments={options.departments}
                  roles={RECRUITABLE_ROLE_KEYS.map((key) => ({ key, label: roles[key as RoleKey].label }))}
                />
              </div>
            ) : null}
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Readiness</h2>
            <DetailGrid
              className="mt-4"
              items={[
                {
                  label: "Onboarding",
                  value: progressStatusLabels[employee.onboardingStatus],
                },
                {
                  label: "Offboarding",
                  value: progressStatusLabels[employee.offboardingStatus],
                },
              ]}
            />
          </section>
        </div>
      </div>
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="employee" parentId={employeeId} />
    </div>
  );
}
