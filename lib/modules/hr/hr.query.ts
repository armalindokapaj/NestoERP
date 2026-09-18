import { firstValue } from "@/lib/modules/shared/list-query";
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
  attendanceListQuerySchema,
  employeeListQuerySchema,
  leaveListQuerySchema,
  type AttendanceListQuery,
  type EmployeeListQuery,
  type LeaveListQuery,
} from "./hr.schema";
import { ACCOUNT_STATUSES } from "./hr.person";

/**
 * URL search parameters → validated list queries (PRD #16 §207).
 *
 * Shared by the pages and the API, so `/hr/leave?status=PENDING` and
 * `GET /api/hr/leave?status=PENDING` behave identically. An unknown sort key or
 * status is dropped rather than rejected: a stale bookmark should show the
 * list, not an error page.
 */
type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: RawParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  return firstValue(params[key]);
}

function list<T extends string>(value: string | undefined, allowed: readonly T[]): T[] | undefined {
  if (!value) return undefined;
  const values = value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is T => (allowed as readonly string[]).includes(entry));
  return values.length > 0 ? values : undefined;
}

function sortKey<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
}

function page(params: RawParams): number {
  const value = Number.parseInt(read(params, "page") ?? "1", 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function limit(params: RawParams): number {
  const value = Number.parseInt(read(params, "limit") ?? "25", 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 100) : 25;
}

function flag(params: RawParams, key: string): boolean {
  const value = read(params, key);
  return value === "1" || value === "true";
}

function date(params: RawParams, key: string): string | undefined {
  const value = read(params, key);
  return value && value.trim() !== "" ? value : undefined;
}

export type EmployeeQueryDefaults = Partial<Pick<EmployeeListQuery, "status" | "sort">>;

export function parseEmployeeQuery(
  params: RawParams,
  defaults: EmployeeQueryDefaults = {},
): EmployeeListQuery {
  return employeeListQuerySchema.parse({
    search: read(params, "search") || undefined,
    status: list(read(params, "status"), EMPLOYMENT_STATUSES) ?? defaults.status,
    employmentType: list(read(params, "employmentType"), EMPLOYMENT_TYPES),
    departmentId: read(params, "departmentId") || undefined,
    managerMemberId: read(params, "managerMemberId") || undefined,
    accountStatus: list(read(params, "accountStatus"), ACCOUNT_STATUSES),
    workerCategory: list(read(params, "workerCategory"), WORKER_CATEGORIES),
    tradeId: read(params, "tradeId") || undefined,
    page: page(params),
    limit: limit(params),
    sort: sortKey(read(params, "sort"), EMPLOYEE_SORT_KEYS, defaults.sort ?? "name-asc"),
  });
}

export type LeaveQueryDefaults = Partial<Pick<LeaveListQuery, "status" | "sort" | "mine">>;

export function parseLeaveQuery(
  params: RawParams,
  defaults: LeaveQueryDefaults = {},
): LeaveListQuery {
  return leaveListQuerySchema.parse({
    search: read(params, "search") || undefined,
    status: list(read(params, "status"), LEAVE_STATUSES) ?? defaults.status,
    leaveType: list(read(params, "leaveType"), LEAVE_TYPES),
    companyMemberId: read(params, "memberId") || undefined,
    from: date(params, "from"),
    to: date(params, "to"),
    mine: defaults.mine ?? flag(params, "mine"),
    page: page(params),
    limit: limit(params),
    sort: sortKey(read(params, "sort"), LEAVE_SORT_KEYS, defaults.sort ?? "start-desc"),
  });
}

export type AttendanceQueryDefaults = Partial<
  Pick<AttendanceListQuery, "sort" | "mine" | "exceptionsOnly">
>;

export function parseAttendanceQuery(
  params: RawParams,
  defaults: AttendanceQueryDefaults = {},
): AttendanceListQuery {
  return attendanceListQuerySchema.parse({
    search: read(params, "search") || undefined,
    status: list(read(params, "status"), ATTENDANCE_STATUSES),
    companyMemberId: read(params, "memberId") || undefined,
    from: date(params, "from"),
    to: date(params, "to"),
    mine: defaults.mine ?? flag(params, "mine"),
    exceptionsOnly: defaults.exceptionsOnly ?? flag(params, "exceptions"),
    page: page(params),
    limit: limit(params),
    sort: sortKey(read(params, "sort"), ATTENDANCE_SORT_KEYS, defaults.sort ?? "date-desc"),
  });
}
