import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarDays } from "lucide-react";

import { EmployeeTabs } from "@/components/hr/employee-tabs";
import { LeaveBalanceCard } from "@/components/hr/leave-balance-card";
import { LeaveBalanceForm } from "@/components/hr/leave-balance-form";
import { LeaveTable } from "@/components/hr/leave-table";
import { RecordContextHeader } from "@/components/modules/record-header";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { leaveYearOf, today } from "@/lib/modules/hr/hr.calendar";
import { leaveListQuerySchema } from "@/lib/modules/hr/hr.schema";
import * as leave from "@/lib/modules/hr/leave/leave.service";
import { orDash } from "@/lib/utils/format";
import { employeeBreadcrumbs, employeeTabVisibility, loadEmployee } from "../employee-context";

type Params = { params: Promise<{ memberId: string }> };

export const metadata: Metadata = { title: "Employee leave" };

/**
 * One employee's leave and balances (PRD #16 §79, §217).
 *
 * The balance is set by hand — V0.1 has no accrual engine — and days used are
 * never typed: they are derived from approved leave (PRD #16 §81, §218).
 */
export default async function EmployeeLeaveTabPage({ params }: Params) {
  const { memberId } = await params;
  const { context, employee } = await loadEmployee(memberId);

  if (!employee.capabilities.canViewLeave) notFound();

  const year = leaveYearOf(today());

  const [requests, balances] = await Promise.all([
    leave.listLeave(context, leaveListQuerySchema.parse({ companyMemberId: memberId })),
    can(context, "hr.leave.balance.view")
      ? leave.getBalances(context, memberId, year)
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={employeeBreadcrumbs(employee, "Leave")}
        title={employee.name.fullName}
        subtitle={orDash(employee.jobTitle)}
        status={employee.employmentStatus}
        actions={
          // Nobody sets their own entitlement (PRD #47 §98).
          can(context, "hr.leave.balance.manage") && memberId !== context.membershipId ? (
            <LeaveBalanceForm
              memberId={memberId}
              year={year}
              employeeName={employee.name.fullName}
            />
          ) : null
        }
      />

      <EmployeeTabs
        memberId={employee.memberId}
        active="leave"
        show={employeeTabVisibility(employee)}
      />

      {balances.length > 0 ? <LeaveBalanceCard balances={balances} year={year} /> : null}

      {requests.data.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title="No leave requests."
          description="Requests filed by or for this employee appear here."
        />
      ) : (
        <LeaveTable requests={requests.data} showEmployee={false} />
      )}
    </div>
  );
}
