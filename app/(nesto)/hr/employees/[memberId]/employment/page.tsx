import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { History } from "lucide-react";

import { EmployeeTabs } from "@/components/hr/employee-tabs";
import { DetailGrid, RecordContextHeader } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/access/can";
import { employmentTypeLabels, progressStatusLabels } from "@/lib/modules/hr/hr.status";
import { formatDate, orDash } from "@/lib/utils/format";
import {
  employeeBreadcrumbs,
  employeeTabVisibility,
  loadEmployee,
} from "../employee-context";

type Params = { params: Promise<{ memberId: string }> };

export const metadata: Metadata = { title: "Employment" };

/**
 * The employment tab (PRD #16 §49, §57).
 *
 * Job title, department and access role are not edited here: they live on the
 * team membership, and HR changing somebody's NESTO role by way of a promotion
 * is exactly what PRD #16 §53 forbids. V0.1 keeps no employment-period history
 * either — a rehire is preserved in the activity trail (PRD #16 §57).
 */
export default async function EmploymentTabPage({ params }: Params) {
  const { memberId } = await params;
  const { context, employee } = await loadEmployee(memberId);

  if (!can(context, "hr.employment.view")) notFound();

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={employeeBreadcrumbs(employee, "Employment")}
        title={employee.name.fullName}
        subtitle={orDash(employee.jobTitle)}
        status={employee.employmentStatus}
        actions={
          employee.capabilities.canEditEmployment ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/hr/employees/${employee.memberId}/employment/edit`}>Edit</Link>
            </Button>
          ) : null
        }
      />

      <EmployeeTabs
        memberId={employee.memberId}
        active="employment"
        show={employeeTabVisibility(employee)}
      />

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">Terms</h2>
        <DetailGrid
          className="mt-4"
          columns={3}
          items={[
            { label: "Employee number", value: orDash(employee.employeeNumber) },
            { label: "Employment type", value: employmentTypeLabels[employee.employmentType] },
            { label: "Employment status", value: employee.employmentStatus },
            {
              label: "Start date",
              value: employee.startDate ? formatDate(employee.startDate) : "—",
            },
            {
              label: "Probation ends",
              value: employee.probationEndDate ? formatDate(employee.probationEndDate) : "—",
            },
            { label: "End date", value: employee.endDate ? formatDate(employee.endDate) : "—" },
            {
              label: "Manager",
              value: employee.manager ? (
                <Link
                  href={`/hr/employees/${employee.manager.memberId}`}
                  className="hover:text-accent"
                >
                  {employee.manager.fullName}
                </Link>
              ) : (
                "—"
              ),
            },
            { label: "Work location", value: orDash(employee.workLocation) },
            { label: "Weekly hours", value: orDash(employee.weeklyHours) },
          ]}
        />
      </section>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">Managed in Team</h2>
        <p className="mt-1 text-meta text-fg-subtle">
          These are company membership facts, not employment terms. A promotion may change a job
          title without changing what somebody can do in NESTO (PRD #16 §53).
        </p>
        <DetailGrid
          className="mt-4"
          columns={3}
          items={[
            { label: "Job title", value: orDash(employee.jobTitle) },
            { label: "Department", value: orDash(employee.department?.name) },
            { label: "Access role", value: employee.role.name },
            { label: "Company access", value: employee.membershipStatus },
            { label: "Onboarding", value: progressStatusLabels[employee.onboardingStatus] },
            { label: "Offboarding", value: progressStatusLabels[employee.offboardingStatus] },
          ]}
        />
        <div className="mt-4 border-t border-line pt-4">
          <Button asChild variant="secondary" size="sm">
            <Link href={`/team/${employee.memberId}`}>Open team membership</Link>
          </Button>
        </div>
      </section>

      {employee.capabilities.canViewActivity ? (
        <p className="flex items-center gap-2 text-meta text-fg-subtle">
          <History aria-hidden="true" className="size-3.5" />
          Employment history, including any rehire, is kept in the{" "}
          <Link
            href={`/hr/employees/${employee.memberId}/activity`}
            className="text-accent-strong hover:underline"
          >
            activity trail
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
