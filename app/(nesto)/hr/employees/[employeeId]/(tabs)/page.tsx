import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { RequestAccountButton } from "@/components/hr/request-account";
import { DetailGrid } from "@/components/modules/record-header";
import { membershipHref, personHref } from "@/components/people/person-link";
import { employmentChangeOptions } from "@/lib/modules/hr/employment/employment.options";
import { hrLabel } from "@/components/hr/hr-labels";
import { getTranslations } from "@/lib/i18n/server";
import { RECRUITABLE_ROLE_KEYS } from "@/lib/modules/hr/recruitment/candidate.schema";
import { roles } from "@/config/roles";
import type { RoleKey } from "@/config/roles";
import { formatDate, orDash } from "@/lib/utils/format";
import { loadEmployee } from "../employee-context";

type Params = { params: Promise<{ employeeId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { employeeId } = await params;
  try {
    const { employee } = await loadEmployee(employeeId);
    return { title: employee.name.fullName };
  } catch {
    const t = await getTranslations("hr");
    return { title: t("columns.employee") };
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
  const t = await getTranslations("hr");
  const options = changes ? await employmentChangeOptions(context, employeeId) : { departments: [], managers: [], documents: [], companies: [] };

  return (
    <div className="space-y-5">
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
            {employee.endDate ? t("employee.endedOn", { date: formatDate(employee.endDate) }) : t("employee.ended")}{t("employee.stillAccess")}{" "}
            <Link
              href={membershipHref(employee.memberId)}
              className="font-medium underline underline-offset-2"
            >
              {t("employee.teamAction")}
            </Link>
            {t("employee.takenDeliberately")}
          </p>
        ) : (
          <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
            {employee.endDate ? t("employee.endedOn", { date: formatDate(employee.endDate) }) : t("employee.ended")}{t("employee.accessSeparate")}{" "}
            <Link href={membershipHref(employee.memberId)} className="text-accent-strong hover:underline">
              {t("employee.team")}
            </Link>
            {t("employee.fullStop")}
          </p>
        )
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">{t("tabs.employment")}</h2>
          <DetailGrid
            className="mt-4"
            columns={3}
            items={[
              { label: t("fields.employeeNumber"), value: orDash(employee.employeeNumber) },
              { label: t("fields.employmentType"), value: hrLabel(t, "employmentType", employee.employmentType) },
              { label: t("fields.workerCategory"), value: employee.workerCategory ? hrLabel(t, "workerCategory", employee.workerCategory) : "—" },
              { label: t("columns.trade"), value: orDash(employee.trade?.name) },
              { label: t("columns.department"), value: orDash(employee.department?.name) },
              { label: t("fields.jobTitle"), value: orDash(employee.jobTitle) },
              {
                label: t("fields.startDate"),
                value: employee.startDate ? formatDate(employee.startDate) : "—",
              },
              {
                label: t("fields.probationEnds"),
                value: employee.probationEndDate ? formatDate(employee.probationEndDate) : "—",
              },
              {
                label: t("fields.endDate"),
                value: employee.endDate ? formatDate(employee.endDate) : "—",
              },
              {
                label: t("fields.workLocation"),
                value: orDash([employee.workLocationType ? hrLabel(t, "workLocationType", employee.workLocationType) : null, employee.workLocation].filter(Boolean).join(", ")),
              },
              { label: t("fields.weeklyHours"), value: orDash(employee.weeklyHours) },
            ]}
          />
          {employee.capabilities.canViewHistory ? (
            <p className="mt-4 border-t border-line pt-3 text-meta text-fg-subtle">
              {t("employee.howTheyGotHere")}{" "}
              <Link href={`/hr/employees/${employee.id}/history`} className="text-accent-strong hover:underline">
                {t("employee.employmentHistory")}
              </Link>
              {t("employee.fullStop")}
            </p>
          ) : null}
        </section>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("employee.contact")}</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: t("employee.workEmail"), value: orDash(employee.email) },
                { label: t("employee.phone"), value: orDash(employee.phone) },
              ]}
            />
            <p className="mt-4 border-t border-line pt-3 text-meta text-fg-subtle">
              {t("employee.contactLiveOn")}{" "}
              <Link href={personHref({ personId: employee.personId })!} className="text-accent-strong hover:underline">
                {t("employee.personProfile")}
              </Link>
              {t("employee.notOnEmployment")}
            </p>
          </section>

          <section className="nesto-card p-5" aria-labelledby="account-heading" data-testid="employee-account">
            <h2 id="account-heading" className="text-card font-semibold text-fg">
              {t("columns.nestoAccount")}
            </h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: t("employee.account"), value: hrLabel(t, "accountStatus", employee.accountStatus) },
                ...(employee.role ? [{ label: t("employee.role"), value: employee.role.name }] : []),
              ]}
            />
            <p className="mt-4 border-t border-line pt-3 text-meta text-fg-subtle">
              {employee.memberId ? (
                <>
                  {t("employee.accessManagedOn")}{" "}
                  <Link href={membershipHref(employee.memberId)} className="text-accent-strong hover:underline">
                    {t("employee.teamMembership")}
                  </Link>
                  {t("employee.neverRemoves")}
                </>
              ) : (
                t("employee.noLogin")
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
            <h2 className="text-card font-semibold text-fg">{t("employee.readiness")}</h2>
            <DetailGrid
              className="mt-4"
              items={[
                {
                  label: t("meta.onboarding"),
                  value: hrLabel(t, "progressStatus", employee.onboardingStatus),
                },
                {
                  label: t("meta.offboarding"),
                  value: hrLabel(t, "progressStatus", employee.offboardingStatus),
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
