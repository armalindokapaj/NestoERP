import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CalendarCheck } from "lucide-react";

import { AttendanceTable } from "@/components/hr/attendance-table";
import { Pagination } from "@/components/data/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import * as attendance from "@/lib/modules/hr/attendance/attendance.service";
import { parseAttendanceQuery } from "@/lib/modules/hr/hr.query";
import { loadEmployee } from "../../employee-context";
import { getTranslations } from "@/lib/i18n/server";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

type Params = {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hr");
  return { title: t("meta.employeeAttendance") };
}

/** One employee's attendance days (PRD #16 §97, §114). */
export default async function EmployeeAttendanceTabPage({ params, searchParams }: Params) {
  const { employeeId } = await params;
  const { context, employee } = await loadEmployee(employeeId, "/attendance");

  if (!employee.capabilities.canViewAttendance) notFound();

  const search = await searchParams;
  // The tab is this employment's days: its id wins over any `employeeId` in the address (AUD-08 §3, DT-02).
  const query = parseAttendanceQuery({ ...search, employeeId });
  const result = await attendance.listAttendance(context, query);
  const basePath = `/hr/employees/${employeeId}/attendance`;
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect(basePath, search, result.pagination.page));

  const t = await getTranslations("hr");
  return (
    <div className="space-y-5">
      {result.data.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck />}
          title={t("attendance.emptyPeriodTitle")}
          description={t("attendance.employeeEmptyDescription")}
        />
      ) : (
        <>
          <AttendanceTable records={result.data} showEmployee={false} listId="hr.employee-attendance" />
          {/* Page links keep the tab's other query keys (AUD-08 §3). */}
          <Pagination meta={result.pagination} buildHref={(page) => pageHref(basePath, search, page)} />
        </>
      )}
    </div>
  );
}
