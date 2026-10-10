import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";

import { LeaveBalanceCard } from "@/components/hr/leave-balance-card";
import { LeaveTable } from "@/components/hr/leave-table";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { leaveYearOf, today } from "@/lib/modules/hr/hr.calendar";
import { leaveListQuerySchema } from "@/lib/modules/hr/hr.schema";
import * as leave from "@/lib/modules/hr/leave/leave.service";
import { loadEmployee } from "../../employee-context";
import { getTranslations } from "@/lib/i18n/server";
import { Pagination } from "@/components/data/pagination";
import { firstValue, listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

type Params = {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hr");
  return { title: t("meta.employeeLeave") };
}

/**
 * One employee's leave and balances (PRD #16 §79, §217).
 *
 * The balance is set by hand — V0.1 has no accrual engine — and days used are
 * never typed: they are derived from approved leave (PRD #16 §81, §218).
 */
export default async function EmployeeLeaveTabPage({ params, searchParams }: Params) {
  const { employeeId } = await params;
  const { context, employee } = await loadEmployee(employeeId, "/leave");

  if (!employee.capabilities.canViewLeave) notFound();

  const year = leaveYearOf(today());
  const search = await searchParams;
  const requested = Number.parseInt(firstValue(search.page) ?? "1", 10);
  const query = leaveListQuerySchema.parse({ employeeId, page: Number.isFinite(requested) && requested > 0 ? requested : 1 });
  const basePath = `/hr/employees/${employeeId}/leave`;

  const [requests, balances] = await Promise.all([
    leave.listLeave(context, query),
    can(context, "hr.leave.balance.view")
      ? leave.getBalances(context, employeeId, year)
      : Promise.resolve([]),
  ]);
  // Every request is reachable page by page — the tab used to stop silently at 25 (AUD-08 §4, DT-05).
  if (requests.pagination.page !== query.page) redirect(listPageRedirect(basePath, search, requests.pagination.page));

  const t = await getTranslations("hr");
  return (
    <div className="space-y-5">
      {balances.length > 0 ? <LeaveBalanceCard balances={balances} year={year} /> : null}

      {requests.data.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title={t("leave.noRequests")}
          description={t("leave.employeeEmptyDescription")}
        />
      ) : (
        <>
          <LeaveTable requests={requests.data} showEmployee={false} listId="hr.employee-leave" />
          <Pagination meta={requests.pagination} buildHref={(next) => pageHref(basePath, search, next)} />
        </>
      )}
    </div>
  );
}
