import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LeaveForm } from "@/components/hr/leave-form";
import { LeaveBalanceCard } from "@/components/hr/leave-balance-card";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { createLeaveAction } from "@/lib/actions/hr";
import { requireModule } from "@/lib/context/current-user";
import { leaveYearOf, today } from "@/lib/modules/hr/hr.calendar";
import { listEmployees } from "@/lib/modules/hr/employees/employee.service";
import * as leave from "@/lib/modules/hr/leave/leave.service";

export const metadata: Metadata = { title: "Request leave" };

/**
 * Request leave (PRD #16 §75, §191).
 *
 * Filing your own needs only self-service; filing somebody else's needs the
 * module grant, which is why the employee picker is absent without it.
 */
export default async function NewLeavePage() {
  const context = await requireModule("hr");

  const forOthers = can(context, "hr.leave.create");
  if (!forOthers && !can(context, "hr.self.leave")) redirect("/access-denied");

  const year = leaveYearOf(today());

  const [employees, balances] = await Promise.all([
    forOthers && can(context, "hr.employee.view")
      ? listEmployees(context, {
          status: ["ACTIVE", "ON_LEAVE", "PLANNED"],
          page: 1,
          limit: 100,
          sort: "name-asc",
        })
      : null,
    // Their own balance, so the entitlement is in front of them while they ask.
    can(context, "hr.self.leave") || can(context, "hr.leave.balance.view")
      ? leave.getBalances(context, context.membershipId, year).catch(() => [])
      : Promise.resolve([]),
  ]);

  async function action(formData: FormData) {
    "use server";
    return createLeaveAction(formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "HR", href: "/hr" },
          { label: "Leave", href: "/hr/leave" },
          { label: "Request leave" },
        ]}
        title="Request leave"
        subtitle="Saved as a draft. Submit it when you are ready for a decision."
      />

      {balances.length > 0 ? <LeaveBalanceCard balances={balances} year={year} /> : null}

      <LeaveForm
        action={action}
        employees={
          employees
            ? employees.data.map((employee) => ({
                value: employee.memberId,
                label: employee.name.fullName,
              }))
            : undefined
        }
        cancelHref="/hr/leave"
        submitLabel="Create request"
        pendingLabel="Creating…"
      />
    </div>
  );
}
