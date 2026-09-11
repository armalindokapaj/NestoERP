import type { Metadata } from "next";
import { notFound } from "next/navigation";
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

type Params = {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Employee attendance" };

/** One employee's attendance days (PRD #16 §97, §114). */
export default async function EmployeeAttendanceTabPage({ params, searchParams }: Params) {
  const { memberId } = await params;
  const { context, employee } = await loadEmployee(memberId);

  if (!employee.capabilities.canViewAttendance) notFound();

  const search = await searchParams;
  const query = parseAttendanceQuery({ ...search, memberId });
  const result = await attendance.listAttendance(context, query);

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={employeeBreadcrumbs(employee, "Attendance")}
        title={employee.name.fullName}
        subtitle={orDash(employee.jobTitle)}
        status={employee.employmentStatus}
      />

      <EmployeeTabs
        memberId={employee.memberId}
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
          <AttendanceTable records={result.data} showEmployee={false} />
          <Pagination
            meta={result.pagination}
            buildHref={(page) =>
              page > 1
                ? `/hr/employees/${memberId}/attendance?page=${page}`
                : `/hr/employees/${memberId}/attendance`
            }
          />
        </>
      )}
    </div>
  );
}
