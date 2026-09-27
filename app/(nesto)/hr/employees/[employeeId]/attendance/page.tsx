import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CalendarCheck } from "lucide-react";

import { AttendanceTable } from "@/components/hr/attendance-table";
import { EmployeeTabs } from "@/components/hr/employee-tabs";
import { Pagination } from "@/components/data/pagination";
import { RecordContextHeader } from "@/components/modules/record-header";
import { EmptyState } from "@/components/ui/empty-state";
import * as attendance from "@/lib/modules/hr/attendance/attendance.service";
import { parseAttendanceQuery } from "@/lib/modules/hr/hr.query";
import { orDash } from "@/lib/utils/format";
import { employeeBreadcrumbs, employeeTabVisibility, loadEmployee } from "../employee-context";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

type Params = {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Employee attendance" };

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

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={employeeBreadcrumbs(employee, "Attendance")}
        title={employee.name.fullName}
        subtitle={orDash(employee.jobTitle)}
        status={employee.employmentStatus}
      />

      <EmployeeTabs
        employeeId={employee.id}
        active="attendance"
        show={employeeTabVisibility(employee)}
      />

      {result.data.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck />}
          title="No attendance records for this period."
          description="Days recorded by HR, by this employee, or written from approved leave appear here."
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
