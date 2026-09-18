import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { History } from "lucide-react";

import { EmploymentChanges } from "@/components/hr/employment-changes";
import { EmployeeTabs } from "@/components/hr/employee-tabs";
import { DetailGrid, RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { todayDay } from "@/lib/modules/hr/employment/employment.dates";
import { workLocationTypeLabels } from "@/lib/modules/hr/employment/employment.labels";
import { employmentChangeOptions } from "@/lib/modules/hr/employment/employment.options";
import { employmentStatusLabels, employmentTypeLabels, progressStatusLabels } from "@/lib/modules/hr/hr.status";
import { formatDate, orDash } from "@/lib/utils/format";
import { employeeBreadcrumbs, employeeTabVisibility, loadEmployee } from "../employee-context";

type Params = { params: Promise<{ memberId: string }> };

export const metadata: Metadata = { title: "Employment" };

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
  const { memberId } = await params;
  const { context, employee } = await loadEmployee(memberId);

  if (!can(context, "hr.employment.view")) notFound();
  const options = await employmentChangeOptions(context, memberId);

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={employeeBreadcrumbs(employee, "Employment")}
        title={employee.name.fullName}
        subtitle={orDash(employee.jobTitle)}
        status={employee.employmentStatus}
        actions={<EmploymentChanges employee={employee} options={options} today={todayDay()} />}
      />

      <EmployeeTabs memberId={employee.memberId} active="employment" show={employeeTabVisibility(employee)} />

      <section className="nesto-card p-5" aria-labelledby="current-assignment">
        <h2 id="current-assignment" className="text-card font-semibold text-fg">
          Current assignment
        </h2>
        <DetailGrid
          className="mt-4"
          columns={3}
          items={[
            { label: "Employing company", value: context.company.name },
            { label: "Department", value: orDash(employee.department?.name) },
            { label: "Job title", value: orDash(employee.jobTitle) },
            {
              label: "Manager",
              value: employee.manager ? (
                <Link href={`/hr/employees/${employee.manager.memberId}`} className="hover:text-accent">
                  {employee.manager.fullName}
                </Link>
              ) : (
                "—"
              ),
            },
            {
              label: "Work location",
              value: orDash([employee.workLocationType ? workLocationTypeLabels[employee.workLocationType] : null, employee.workLocation].filter(Boolean).join(", ")),
            },
            { label: "Employment type", value: employmentTypeLabels[employee.employmentType] },
            { label: "Status", value: employmentStatusLabels[employee.employmentStatus] },
            { label: employee.employmentStatus === "PLANNED" ? "Planned start" : "Start date", value: employee.startDate ? formatDate(employee.startDate) : "—" },
            { label: employee.employmentStatus === "ENDED" ? "Last day" : "Planned end", value: employee.endDate ? formatDate(employee.endDate) : "—" },
          ]}
        />
      </section>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">Terms</h2>
        <DetailGrid
          className="mt-4"
          columns={3}
          items={[
            { label: "Employee number", value: orDash(employee.employeeNumber) },
            { label: "Probation ends", value: employee.probationEndDate ? formatDate(employee.probationEndDate) : "—" },
            { label: "Weekly hours", value: orDash(employee.weeklyHours) },
            { label: "Onboarding", value: progressStatusLabels[employee.onboardingStatus] },
            { label: "Offboarding", value: progressStatusLabels[employee.offboardingStatus] },
          ]}
        />
      </section>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">Access in NESTO</h2>
        <p className="mt-1 text-meta text-fg-subtle">
          The NESTO role decides what somebody can do here; the job title does not. A promotion never changes it, and
          ending employment never removes access — both are Team decisions.
        </p>
        <DetailGrid
          className="mt-4"
          columns={3}
          items={[
            { label: "Access role", value: employee.role.name },
            { label: "Company access", value: employee.membershipStatus },
          ]}
        />
        <div className="mt-4 border-t border-line pt-4">
          <Link href={`/team/${employee.memberId}`} className="text-table text-accent-strong hover:underline">
            Open team membership
          </Link>
        </div>
      </section>

      {employee.capabilities.canViewHistory ? (
        <p className="flex items-center gap-2 text-meta text-fg-subtle">
          <History aria-hidden="true" className="size-3.5" />
          Every change, from its date, is in the{" "}
          <Link href={`/hr/employees/${employee.memberId}/history`} className="text-accent-strong hover:underline">
            employment history
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
