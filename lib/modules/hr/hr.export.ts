import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import * as attendance from "./attendance/attendance.service";
import * as employees from "./employees/employee.service";
import {
  parseAttendanceQuery,
  parseEmployeeQuery,
  parseLeaveQuery,
} from "./hr.query";
import {
  attendanceStatusLabels,
  attendanceSourceLabels,
  employmentStatusLabels,
  employmentTypeLabels,
  leaveStatusLabels,
  leaveTypeLabels,
} from "./hr.status";
import * as leave from "./leave/leave.service";

/**
 * CSV export (PRD #16 §146, §147).
 *
 * Deliberately built on the list services rather than beside them: the export
 * parses the same query, calls the same function and therefore inherits the
 * same scope, the same permissions and the same filters. An export that went
 * to the database on its own would eventually disagree with the screen it
 * claims to be a copy of — and the direction it disagrees in is a leak.
 *
 * Pay is not exportable here. The compensation report is its own thing behind
 * its own permission; a "download the employee list" button must never become
 * the route around it (PRD #16 §68, §147).
 */
export const EXPORT_TYPES = ["employees", "leave", "attendance"] as const;
export type HrExportType = (typeof EXPORT_TYPES)[number];

/** A hard cap: an export is a spreadsheet, not a database dump. */
const MAX_ROWS = 1000;

export async function exportHr(
  context: UserContext,
  type: HrExportType,
  params: URLSearchParams,
): Promise<{ filename: string; csv: string }> {
  assertModule(context, "hr");
  assertPermission(context, "hr.export");

  if (type === "employees") {
    const query = { ...parseEmployeeQuery(params), page: 1, limit: MAX_ROWS };
    const result = await employees.listEmployees(context, query);

    return {
      filename: "hr-employees.csv",
      csv: toCsv(
        ["Employee", "Employee number", "Email", "Job title", "Department", "Manager", "Type", "Status", "Start date", "End date"],
        result.data.map((row) => [
          row.name.fullName,
          row.employeeNumber ?? "",
          row.email,
          row.jobTitle ?? "",
          row.department?.name ?? "",
          row.manager?.fullName ?? "",
          employmentTypeLabels[row.employmentType],
          employmentStatusLabels[row.employmentStatus],
          row.startDate ?? "",
          row.endDate ?? "",
        ]),
      ),
    };
  }

  if (type === "leave") {
    const query = { ...parseLeaveQuery(params), page: 1, limit: MAX_ROWS };
    const result = await leave.listLeave(context, query);

    // No reason column: it may be medical, and a file on somebody's laptop is
    // exactly where it stops being governed (PRD #16 §95, §147).
    return {
      filename: "hr-leave.csv",
      csv: toCsv(
        ["Employee", "Type", "From", "To", "Days", "Status", "Decided by"],
        result.data.map((row) => [
          row.employee.fullName,
          leaveTypeLabels[row.leaveType],
          row.startDate,
          row.endDate,
          row.days,
          leaveStatusLabels[row.status],
          row.decidedBy ?? "",
        ]),
      ),
    };
  }

  const query = { ...parseAttendanceQuery(params), page: 1, limit: MAX_ROWS };
  const result = await attendance.listAttendance(context, query);

  return {
    filename: "hr-attendance.csv",
    csv: toCsv(
      ["Employee", "Date", "Status", "Check in", "Check out", "Worked minutes", "Source", "Exception"],
      result.data.map((row) => [
        row.employee.fullName,
        row.date,
        attendanceStatusLabels[row.status],
        row.checkIn ?? "",
        row.checkOut ?? "",
        row.workedMinutes === null ? "" : String(row.workedMinutes),
        attendanceSourceLabels[row.source],
        row.isException ? "yes" : "no",
      ]),
    ),
  };
}

/**
 * Quotes every field, always.
 *
 * A name with a comma in it, or a note with a line break, is ordinary data —
 * and a spreadsheet that splits one row into two is a worse answer than a file
 * with more quotation marks in it than strictly necessary.
 */
function toCsv(headers: string[], rows: string[][]): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
}
