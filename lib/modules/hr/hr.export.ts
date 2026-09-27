import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prepareExport, type ExportColumn, type ExportLimits, type PreparedExport } from "@/lib/core/export/exporter";
import { assertExportParams, assertExportRange, type ParamRules } from "@/lib/core/export/export-params";
import * as attendance from "./attendance/attendance.service";
import * as employees from "./employees/employee.service";
import { parseAttendanceQuery, parseEmployeeQuery, parseLeaveQuery } from "./hr.query";
import { ACCOUNT_STATUSES } from "./hr.person";
import {
  ATTENDANCE_SORT_KEYS,
  ATTENDANCE_STATUSES,
  EMPLOYEE_SORT_KEYS,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPES,
  LEAVE_SORT_KEYS,
  LEAVE_STATUSES,
  LEAVE_TYPES,
  WORKER_CATEGORIES,
} from "./hr.schema";
import {
  accountStatusLabels,
  attendanceSourceLabels,
  attendanceStatusLabels,
  employmentStatusLabels,
  employmentTypeLabels,
  leaveStatusLabels,
  leaveTypeLabels,
  workerCategoryLabels,
} from "./hr.status";
import type { AttendanceDTO, EmployeeSummaryDTO, LeaveRequestDTO } from "./hr.types";
import * as leave from "./leave/leave.service";

/**
 * CSV export (PRD #16 §146, §147; AUD-08 §7).
 *
 * Deliberately built on the list services rather than beside them: the export
 * parses the same query, calls the same function and therefore inherits the
 * same scope, the same permissions, the same filters and the same order — only
 * the page is gone. An export that went to the database on its own would
 * eventually disagree with the screen it claims to be a copy of — and the
 * direction it disagrees in is a leak. A filter the list would drop is refused
 * here instead of broadening the file (AUD-08 §3, DT-03).
 *
 * Pay is not exportable here. The compensation report is its own thing behind
 * its own permission; a "download the employee list" button must never become
 * the route around it (PRD #16 §68, §147). No leave reason (it may be medical,
 * PRD #16 §95), no attendance notes, and never a membership id (E-08): a person
 * is named, and addressed by their employment record's id.
 *
 * Limits: 1,000 rows (the existing hard cap), 10 MiB, 30 s. Every cell is
 * quoted and lines end CRLF, as this file always has.
 */
export const EXPORT_TYPES = ["employees", "leave", "attendance"] as const;
export type HrExportType = (typeof EXPORT_TYPES)[number];

/** A hard cap: an export is a spreadsheet, not a database dump. */
export const HR_EXPORT_LIMITS: Partial<ExportLimits> = { maxRows: 1000 };

const LAYOUT = { lineBreak: "\r\n", quoteAll: true } as const;

export const HR_EXPORT_PARAMS: Record<HrExportType, ParamRules> = {
  employees: {
    search: { kind: "text" },
    status: { kind: "enumList", allowed: EMPLOYMENT_STATUSES, caseInsensitive: true },
    employmentType: { kind: "enumList", allowed: EMPLOYMENT_TYPES, caseInsensitive: true },
    departmentId: { kind: "id" },
    managerMemberId: { kind: "id" },
    accountStatus: { kind: "enumList", allowed: ACCOUNT_STATUSES, caseInsensitive: true },
    workerCategory: { kind: "enumList", allowed: WORKER_CATEGORIES, caseInsensitive: true },
    tradeId: { kind: "id" },
    sort: { kind: "enum", allowed: EMPLOYEE_SORT_KEYS },
  },
  leave: {
    search: { kind: "text" },
    status: { kind: "enumList", allowed: LEAVE_STATUSES, caseInsensitive: true },
    leaveType: { kind: "enumList", allowed: LEAVE_TYPES, caseInsensitive: true },
    memberId: { kind: "id" },
    from: { kind: "date" },
    to: { kind: "date" },
    mine: { kind: "flag" },
    sort: { kind: "enum", allowed: LEAVE_SORT_KEYS },
  },
  attendance: {
    search: { kind: "text" },
    status: { kind: "enumList", allowed: ATTENDANCE_STATUSES, caseInsensitive: true },
    memberId: { kind: "id" },
    from: { kind: "date" },
    to: { kind: "date" },
    mine: { kind: "flag" },
    exceptions: { kind: "flag" },
    sort: { kind: "enum", allowed: ATTENDANCE_SORT_KEYS },
  },
};

/** The standard columns of each file (AUD-08 §7, DT-15). */
export function employeeColumns(context: UserContext): ExportColumn<EmployeeSummaryDTO>[] {
  return [
    { header: "Company ID", kind: "code", value: () => context.companyId },
    { header: "Employee ID", kind: "code", value: (row) => row.id },
    { header: "Employee", kind: "text", value: (row) => row.name.fullName },
    { header: "Employee number", kind: "code", value: (row) => row.employeeNumber },
    { header: "Email", kind: "text", value: (row) => row.email },
    { header: "Job title", kind: "text", value: (row) => row.jobTitle },
    { header: "Department", kind: "text", value: (row) => row.department?.name },
    { header: "Manager", kind: "text", value: (row) => row.manager?.fullName },
    { header: "Type", kind: "status", value: (row) => employmentTypeLabels[row.employmentType] },
    { header: "Category", kind: "status", value: (row) => (row.workerCategory ? workerCategoryLabels[row.workerCategory] : null) },
    { header: "Trade", kind: "text", value: (row) => row.trade?.name },
    { header: "NESTO account", kind: "status", value: (row) => accountStatusLabels[row.accountStatus] },
    { header: "Status", kind: "status", value: (row) => employmentStatusLabels[row.employmentStatus] },
    { header: "Start date", kind: "date", value: (row) => row.startDate },
    { header: "End date", kind: "date", value: (row) => row.endDate },
  ];
}

export function leaveColumns(context: UserContext): ExportColumn<LeaveRequestDTO>[] {
  return [
    { header: "Company ID", kind: "code", value: () => context.companyId },
    { header: "Leave request ID", kind: "code", value: (row) => row.id },
    { header: "Employee ID", kind: "code", value: (row) => row.employee.employeeId },
    { header: "Employee", kind: "text", value: (row) => row.employee.fullName },
    { header: "Type", kind: "status", value: (row) => leaveTypeLabels[row.leaveType] },
    { header: "From", kind: "date", value: (row) => row.startDate },
    { header: "To", kind: "date", value: (row) => row.endDate },
    { header: "Days", kind: "decimal", value: (row) => row.days },
    { header: "Status", kind: "status", value: (row) => leaveStatusLabels[row.status] },
    { header: "Decided by", kind: "text", value: (row) => row.decidedByName },
  ];
}

export function attendanceColumns(context: UserContext): ExportColumn<AttendanceDTO>[] {
  return [
    { header: "Company ID", kind: "code", value: () => context.companyId },
    { header: "Attendance ID", kind: "code", value: (row) => row.id },
    { header: "Employee ID", kind: "code", value: (row) => row.employee.employeeId },
    { header: "Employee", kind: "text", value: (row) => row.employee.fullName },
    { header: "Date", kind: "date", value: (row) => row.date },
    { header: "Status", kind: "status", value: (row) => attendanceStatusLabels[row.status] },
    { header: "Check in", kind: "text", value: (row) => row.checkIn },
    { header: "Check out", kind: "text", value: (row) => row.checkOut },
    { header: "Worked minutes", kind: "integer", value: (row) => row.workedMinutes },
    { header: "Source", kind: "status", value: (row) => attendanceSourceLabels[row.source] },
    { header: "Exception", kind: "text", value: (row) => (row.isException ? "yes" : "no") },
  ];
}

export async function exportHr(
  context: UserContext,
  type: HrExportType,
  params: URLSearchParams,
  options: { evaluatedAt?: Date } = {},
): Promise<PreparedExport> {
  assertModule(context, "hr");
  assertPermission(context, "hr.export");
  assertExportParams(params, HR_EXPORT_PARAMS[type], { selector: ["type"] });
  const shared = { limits: HR_EXPORT_LIMITS, layout: LAYOUT, evaluatedAt: options.evaluatedAt };

  if (type === "employees") {
    const query = parseEmployeeQuery(params);
    return prepareExport({
      ...shared,
      id: "hr.employees",
      filename: "hr-employees.csv",
      columns: employeeColumns(context),
      read: async (take) => {
        const result = await employees.listEmployees(context, { ...query, page: 1, limit: take });
        return { rows: result.data, total: result.pagination.total };
      },
    });
  }

  assertExportRange(params, "from", "to");

  if (type === "leave") {
    const query = parseLeaveQuery(params);
    return prepareExport({
      ...shared,
      id: "hr.leave",
      filename: "hr-leave.csv",
      columns: leaveColumns(context),
      read: async (take) => {
        const result = await leave.listLeave(context, { ...query, page: 1, limit: take });
        return { rows: result.data, total: result.pagination.total };
      },
    });
  }

  const query = parseAttendanceQuery(params);
  return prepareExport({
    ...shared,
    id: "hr.attendance",
    filename: "hr-attendance.csv",
    columns: attendanceColumns(context),
    read: async (take) => {
      const result = await attendance.listAttendance(context, { ...query, page: 1, limit: take });
      return { rows: result.data, total: result.pagination.total };
    },
  });
}
