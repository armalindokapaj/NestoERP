import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";
import { History } from "lucide-react";

import { DetailGrid } from "@/components/modules/record-header";
import { PersonLink, membershipHref } from "@/components/people/person-link";
import { can } from "@/lib/access/can";
import { employmentChangeOptions } from "@/lib/modules/hr/employment/employment.options";
import { hrLabel } from "@/components/hr/hr-labels";
import { getTranslations } from "@/lib/i18n/server";
import { formatDate, orDash } from "@/lib/utils/format";
import { loadEmployee } from "../../employee-context";

type Params = { params: Promise<{ employeeId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hr");
  return { title: t("meta.employment") };
}

/**
 * The employment tab (PRD #16 §49, §57; E-03 §54, §160, §163).
 *
 * Where the person sits today — company, department, title, manager, location,
 * type, status — as the employment's history says, and the dated changes that
 * move it. The NESTO role and company access are shown, never changed here: a
 * promotion changes a job, not what somebody can do in NESTO (PRD #16 §53,
 * E-03 §107), and access is Team's decision (E-03 §92).
 */
export default async function EmploymentTabPage({ params }: Params) {
  const { employeeId } = await params;
  const { context, employee } = await loadEmployee(employeeId, "/employment");

  if (!can(context, "hr.employment.view")) notFound();
  const options = await employmentChangeOptions(context, employeeId);
  const t = await getTranslations("hr");

  return (
    <div className="space-y-5">
      <section className="nesto-card p-5" aria-labelledby="current-assignment">
        <h2 id="current-assignment" className="text-card font-semibold text-fg">
          {t("employment.currentAssignment")}
        </h2>
        <DetailGrid
          className="mt-4"
          columns={3}
          items={[
            { label: t("employment.employingCompany"), value: context.company.name },
            { label: t("columns.department"), value: orDash(employee.department?.name) },
            { label: t("fields.jobTitle"), value: orDash(employee.jobTitle) },
            {
              label: t("columns.manager"),
              value: employee.manager ? <PersonLink memberId={employee.manager.memberId} name={employee.manager.fullName} /> : "—",
            },
            {
              label: t("fields.workLocation"),
              value: orDash([employee.workLocationType ? hrLabel(t, "workLocationType", employee.workLocationType) : null, employee.workLocation].filter(Boolean).join(", ")),
            },
            { label: t("fields.employmentType"), value: hrLabel(t, "employmentType", employee.employmentType) },
            { label: t("columns.status"), value: hrLabel(t, "employmentStatus", employee.employmentStatus) },
            { label: employee.employmentStatus === "PLANNED" ? t("fields.plannedStart") : t("fields.startDate"), value: employee.startDate ? formatDate(employee.startDate) : "—" },
            { label: employee.employmentStatus === "ENDED" ? t("progress.lastDay") : t("fields.plannedEnd"), value: employee.endDate ? formatDate(employee.endDate) : "—" },
          ]}
        />
      </section>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">{t("employment.terms")}</h2>
        <DetailGrid
          className="mt-4"
          columns={3}
          items={[
            { label: t("fields.employeeNumber"), value: orDash(employee.employeeNumber) },
            { label: t("fields.probationEnds"), value: employee.probationEndDate ? formatDate(employee.probationEndDate) : "—" },
            { label: t("fields.weeklyHours"), value: orDash(employee.weeklyHours) },
            { label: t("meta.onboarding"), value: hrLabel(t, "progressStatus", employee.onboardingStatus) },
            { label: t("meta.offboarding"), value: hrLabel(t, "progressStatus", employee.offboardingStatus) },
          ]}
        />
      </section>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">{t("employment.accessInNesto")}</h2>
        <p className="mt-1 text-meta text-fg-subtle">
          {t("employment.accessNote")}
        </p>
        <DetailGrid
          className="mt-4"
          columns={3}
          items={[
            { label: t("columns.nestoAccount"), value: hrLabel(t, "accountStatus", employee.accountStatus) },
            { label: t("employment.accessRole"), value: orDash(employee.role?.name) },
            { label: t("employment.companyAccess"), value: employee.membershipStatus ? hrLabel(t, "membershipStatus", employee.membershipStatus) : "—" },
          ]}
        />
        {employee.memberId ? (
          <div className="mt-4 border-t border-line pt-4">
            <Link href={membershipHref(employee.memberId)} className="text-table text-accent-strong hover:underline">
              {t("employment.openMembership")}
            </Link>
          </div>
        ) : null}
      </section>

      {employee.capabilities.canViewHistory ? (
        <p className="flex items-center gap-2 text-meta text-fg-subtle">
          <History aria-hidden="true" className="size-3.5" />
          {t("employment.everyChange")}{" "}
          <Link href={`/hr/employees/${employee.id}/history`} className="text-accent-strong hover:underline">
            {t("employee.employmentHistory")}
          </Link>
          {t("employee.fullStop")}
        </p>
      ) : null}
    </div>
  );
}
