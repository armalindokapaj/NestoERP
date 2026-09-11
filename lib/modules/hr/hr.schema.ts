import { z } from "zod";

import {
  optionalDate,
  optionalId,
  optionalText,
  requiredText,
} from "@/lib/modules/shared/fields";
import { currencyCode } from "@/lib/modules/finance/finance.fields";

/**
 * HR validation (PRD #16 §183–§199).
 *
 * `companyId`, `employeeProfileId`, `companyMemberId`, `createdByMemberId`,
 * every approval field and `usedDays` are absent from every input schema: they
 * are server-controlled, and accepting any of them from a browser is how
 * somebody approves their own leave or edits a balance directly
 * (PRD #16 §183, §218).
 */

/* -------------------------------------------------------------------------- */
/* Employment                                                                  */
/* -------------------------------------------------------------------------- */

export const EMPLOYMENT_STATUSES = [
  "PLANNED",
  "ACTIVE",
  "ON_LEAVE",
  "SUSPENDED",
  "ENDED",
] as const;

export const EMPLOYMENT_TYPES = [
  "FULL_TIME",
  "PART_TIME",
  "CONTRACTOR",
  "INTERN",
  "TEMPORARY",
  "OTHER",
] as const;

export const PROGRESS_STATUSES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETED",
  "NOT_REQUIRED",
] as const;

/** A business date: a calendar fact, stored at midday UTC (PRD #16 §212). */
const hrDate = z
  .union([z.coerce.date(), z.literal("")])
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : (value as Date)));

const employmentFields = {
  employeeNumber: optionalText(60),
  employmentType: z.enum(EMPLOYMENT_TYPES, { message: "Choose an employment type" }),
  startDate: hrDate,
  probationEndDate: hrDate,
  endDate: hrDate,
  managerMemberId: optionalId,
  workLocation: optionalText(160),
  weeklyHours: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === "" ? undefined : value.trim()))
    .refine((value) => value === undefined || /^\d{1,3}(\.\d{1,2})?$/.test(value), {
      message: "Weekly hours must be a number with at most 2 decimal places",
    })
    .refine((value) => value === undefined || Number.parseFloat(value) <= 168, {
      message: "A week has 168 hours",
    }),
};

/** `endDate >= startDate`: employment cannot end before it starts. */
const datesInOrder = <T extends { startDate?: Date; endDate?: Date }>(schema: z.ZodType<T>) =>
  schema.refine(
    (value) =>
      !value.startDate || !value.endDate || value.endDate.getTime() >= value.startDate.getTime(),
    { message: "The end date cannot be before the start date.", path: ["endDate"] },
  );

export const createEmployeeProfileSchema = datesInOrder(
  z.object({
    companyMemberId: z.string().trim().min(1, "Choose a team member"),
    ...employmentFields,
  }),
);

export const updateEmployeeProfileSchema = datesInOrder(
  z.object({ ...employmentFields, versionUpdatedAt: optionalDate }),
);

export type CreateEmployeeProfileInput = z.infer<typeof createEmployeeProfileSchema>;
export type UpdateEmployeeProfileInput = z.infer<typeof updateEmployeeProfileSchema>;

/** Status is its own action, never a field on the update form (PRD #16 §54). */
export const employmentStatusSchema = z.object({
  status: z.enum(EMPLOYMENT_STATUSES),
  endDate: hrDate,
  note: optionalText(2000),
});

export type EmploymentStatusInput = z.infer<typeof employmentStatusSchema>;

export const progressSchema = z.object({
  status: z.enum(PROGRESS_STATUSES),
});

export const EMPLOYEE_SORT_KEYS = [
  "name-asc",
  "name-desc",
  "start-desc",
  "start-asc",
  "status-asc",
  "department-asc",
] as const;

export type EmployeeSortKey = (typeof EMPLOYEE_SORT_KEYS)[number];

export const employeeListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(EMPLOYMENT_STATUSES)).optional(),
  employmentType: z.array(z.enum(EMPLOYMENT_TYPES)).optional(),
  departmentId: z.string().optional(),
  managerMemberId: z.string().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.enum(EMPLOYEE_SORT_KEYS).default("name-asc"),
});

export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Compensation                                                                */
/* -------------------------------------------------------------------------- */

export const PAY_TYPES = ["SALARY", "HOURLY", "DAILY", "OTHER"] as const;

export const createCompensationSchema = z.object({
  currency: currencyCode,
  payType: z.enum(PAY_TYPES, { message: "Choose a pay type" }),
  baseAmount: z
    .string()
    .transform((value) => value.trim().replace(/\s/g, "").replace(",", "."))
    .refine((value) => /^\d{1,15}(\.\d{1,2})?$/.test(value), {
      message: "Amount must be a number with at most 2 decimal places",
    }),
  effectiveFrom: z.coerce.date(),
  notes: optionalText(2000),
});

export type CreateCompensationInput = z.infer<typeof createCompensationSchema>;

/* -------------------------------------------------------------------------- */
/* Leave                                                                       */
/* -------------------------------------------------------------------------- */

export const LEAVE_TYPES = ["ANNUAL", "SICK", "UNPAID", "PARENTAL", "OTHER"] as const;
export const LEAVE_STATUSES = [
  "DRAFT",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;

const leaveFields = {
  leaveType: z.enum(LEAVE_TYPES, { message: "Choose a leave type" }),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  reason: optionalText(2000),
};

/** `endDate >= startDate` (PRD #16 §76). */
const leaveDatesInOrder = <T extends { startDate: Date; endDate: Date }>(
  schema: z.ZodType<T>,
) =>
  schema.refine((value) => value.endDate.getTime() >= value.startDate.getTime(), {
    message: "The end date cannot be before the start date.",
    path: ["endDate"],
  });

export const createLeaveSchema = leaveDatesInOrder(
  z.object({
    // HR may file leave on somebody's behalf; a person filing their own leaves
    // this empty and the service uses their own membership (PRD #16 §191).
    companyMemberId: optionalId,
    ...leaveFields,
  }),
);

export const updateLeaveSchema = leaveDatesInOrder(
  z.object({ ...leaveFields, versionUpdatedAt: optionalDate }),
);

export type CreateLeaveInput = z.infer<typeof createLeaveSchema>;
export type UpdateLeaveInput = z.infer<typeof updateLeaveSchema>;

/** A rejection must say why (PRD #16 §88). */
export const leaveDecisionSchema = z.object({ note: optionalText(2000) });
export const leaveRejectionSchema = z.object({
  note: requiredText(3, 2000, "Reason"),
});

export const LEAVE_SORT_KEYS = ["start-desc", "start-asc", "created-desc", "days-desc"] as const;
export type LeaveSortKey = (typeof LEAVE_SORT_KEYS)[number];

export const leaveListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(LEAVE_STATUSES)).optional(),
  leaveType: z.array(z.enum(LEAVE_TYPES)).optional(),
  companyMemberId: z.string().optional(),
  from: optionalDate,
  to: optionalDate,
  mine: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.enum(LEAVE_SORT_KEYS).default("start-desc"),
});

export type LeaveListQuery = z.infer<typeof leaveListQuerySchema>;

/** HR sets an entitlement by hand; there is no accrual engine (PRD #16 §81). */
export const leaveBalanceSchema = z.object({
  leaveType: z.enum(LEAVE_TYPES),
  year: z.coerce.number().int().min(2000).max(2100),
  entitledDays: z
    .string()
    .transform((value) => value.trim().replace(",", "."))
    .refine((value) => /^\d{1,4}(\.\d{1,2})?$/.test(value), {
      message: "Entitled days must be a number with at most 2 decimal places",
    }),
  adjustmentDays: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === "" ? "0" : value.trim()))
    .transform((value) => value.replace(",", "."))
    .refine((value) => /^-?\d{1,4}(\.\d{1,2})?$/.test(value), {
      message: "Adjustment must be a number with at most 2 decimal places",
    }),
});

export type LeaveBalanceInput = z.infer<typeof leaveBalanceSchema>;

/* -------------------------------------------------------------------------- */
/* Attendance                                                                  */
/* -------------------------------------------------------------------------- */

export const ATTENDANCE_STATUSES = [
  "PRESENT",
  "ABSENT",
  "ON_LEAVE",
  "REMOTE",
  "HOLIDAY",
  "OFF",
] as const;

/** `HH:MM`, combined with the record's date by the server. */
const timeOfDay = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === "" ? undefined : value.trim()))
  .refine((value) => value === undefined || /^([01]\d|2[0-3]):[0-5]\d$/.test(value), {
    message: "Use a 24-hour time such as 09:00",
  });

export const createAttendanceSchema = z.object({
  companyMemberId: optionalId,
  date: z.coerce.date(),
  status: z.enum(ATTENDANCE_STATUSES, { message: "Choose a status" }),
  checkIn: timeOfDay,
  checkOut: timeOfDay,
  notes: optionalText(1000),
});

export const updateAttendanceSchema = z.object({
  status: z.enum(ATTENDANCE_STATUSES),
  checkIn: timeOfDay,
  checkOut: timeOfDay,
  notes: optionalText(1000),
  versionUpdatedAt: optionalDate,
});

export type CreateAttendanceInput = z.infer<typeof createAttendanceSchema>;
export type UpdateAttendanceInput = z.infer<typeof updateAttendanceSchema>;

export const ATTENDANCE_SORT_KEYS = ["date-desc", "date-asc"] as const;
export type AttendanceSortKey = (typeof ATTENDANCE_SORT_KEYS)[number];

export const attendanceListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(ATTENDANCE_STATUSES)).optional(),
  companyMemberId: z.string().optional(),
  from: optionalDate,
  to: optionalDate,
  mine: z.boolean().default(false),
  exceptionsOnly: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.enum(ATTENDANCE_SORT_KEYS).default("date-desc"),
});

export type AttendanceListQuery = z.infer<typeof attendanceListQuerySchema>;
