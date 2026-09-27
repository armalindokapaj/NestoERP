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
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hr");
  return { title: t("leave.requestLeave") };
}

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
  const t = await getTranslations("hr");

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
      ? leave.getBalances(context, null, year).catch(() => [])
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
          { label: t("meta.hr"), href: "/hr" },
          { label: t("meta.leave"), href: "/hr/leave" },
          { label: t("leave.requestLeave") },
        ]}
        title={t("leave.requestLeave")}
        subtitle={t("leave.newSubtitle")}
      />

      {balances.length > 0 ? <LeaveBalanceCard balances={balances} year={year} /> : null}

      <LeaveForm
        action={action}
        employees={
          employees
            ? employees.data.map((employee) => ({
                value: employee.id,
                label: employee.accountStatus === "NO_ACCOUNT" ? t("leave.noAccountName", { name: employee.name.fullName }) : employee.name.fullName,
              }))
            : undefined
        }
        cancelHref="/hr/leave"
        submitLabel={t("leave.createRequest")}
        pendingLabel={t("common.creating")}
      />
    </div>
  );
}
