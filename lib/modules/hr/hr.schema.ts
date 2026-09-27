import { z } from "zod";

import {
  optionalDate,
  optionalId,
  optionalText,
  requiredText,
} from "@/lib/modules/shared/fields";
import { currencyCode } from "@/lib/modules/finance/finance.fields";
import { isDay } from "@/lib/modules/hr/employment/employment.dates";

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

/**
 * A business date: a calendar fact, stored at midday UTC (PRD #16 §212).
 *
 * Typed as `YYYY-MM-DD`, or a `Date` handed over in-process. Anything else is
 * refused where it was typed: `z.coerce.date()` used to roll 2026-02-30 into
 * 2 March and move an ISO timestamp with an offset onto the previous day, so
 * the stored day was not the one entered (AUD-09 §4, FV-07).
 *
 *   required   empty or absent → "Enter the date."
 *   optional   empty or absent → undefined (create: no value)
 *   clearable  absent → undefined (unchanged); empty or null → null (cleared)
 */
type DayMode = "required" | "optional" | "clearable";
const DAY_MESSAGE = "Enter a real date as YYYY-MM-DD.";

function parseDay(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === "string" && isDay(value.trim())) return new Date(`${value.trim()}T12:00:00.000Z`);
  return undefined;
}

function dayField(mode: "required", message?: string): z.ZodType<Date, unknown>;
function dayField(mode: "optional"): z.ZodType<Date | undefined, unknown>;
function dayField(mode: "clearable"): z.ZodType<Date | null | undefined, unknown>;
function dayField(mode: DayMode, message = "Enter the date."): z.ZodType<Date | null | undefined, unknown> {
  const field = z.unknown().transform((value, ctx) => {
    const blank = value === undefined || value === null || (typeof value === "string" && value.trim() === "");
    if (blank) {
      if (mode === "required") {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return mode === "clearable" && value !== undefined ? null : undefined;
    }
    const day = parseDay(value);
    if (!day) {
      ctx.addIssue({ code: "custom", message: DAY_MESSAGE });
      return z.NEVER;
    }
    return day;
  });
  // An absent key is optional unless the date is required (zod 4 checks the output).
  return mode === "required" ? field : field.optional();
}

const hrDate = dayField("optional");

const WEEKLY_HOURS = /^\d{1,3}(\.\d{1,2})?$/;

const weeklyHours = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === "" ? undefined : value.trim()))
  .refine((value) => value === undefined || WEEKLY_HOURS.test(value), {
    message: "Weekly hours must be a number with at most 2 decimal places",
  })
  .refine((value) => value === undefined || Number.parseFloat(value) <= 168, {
    message: "A week has 168 hours",
  });

/**
 * Any optional field on an edit, with three answers (AUD-09 §4, FV-05):
 * absent is unchanged, empty or null is cleared, anything else must pass
 * `schema` and keeps its own message on its own path. An edit that does not
 * carry a field — a PATCH naming one thing, a control the page did not
 * render — can no longer erase it.
 *
 * AUD-09: candidate for lib/forms.
 */
export function clearable<T extends z.ZodType>(schema: T) {
  return z
    .unknown()
    .transform((value, ctx): z.output<T> | null => {
      if (value === null || (typeof value === "string" && value.trim() === "")) return null;
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", message: issue.message });
        return z.NEVER;
      }
      return (parsed.data ?? null) as z.output<T> | null;
    })
    .optional();
}

const clearableText = (max: number, label: string) =>
  clearable(z.string({ message: `${label} must be text.` }).trim().max(max, `${label} must be ${max} characters or fewer.`));

const clearableWeeklyHours = clearable(
  z
    .union([z.string(), z.number()], { message: "Weekly hours must be a number with at most 2 decimal places" })
    .transform((value) => String(value).trim())
    .refine((value) => WEEKLY_HOURS.test(value), { message: "Weekly hours must be a number with at most 2 decimal places" })
    .refine((value) => Number.parseFloat(value) <= 168, { message: "A week has 168 hours" }),
);

/** `endDate >= startDate`: employment cannot end before it starts. */
const datesInOrder = <T extends { startDate?: Date; endDate?: Date }>(schema: z.ZodType<T>) =>
  schema.refine(
    (value) =>
      !value.startDate || !value.endDate || value.endDate.getTime() >= value.startDate.getTime(),
    { message: "The end date cannot be before the start date.", path: ["endDate"] },
  );

export const WORKER_CATEGORIES = [
  "OFFICE",
  "FIELD",
  "SITE",
  "CONSTRUCTION_WORKER",
  "DRIVER",
  "TECHNICIAN",
  "SUPERVISOR",
  "OTHER",
] as const;

const blankToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([schema, z.literal("")]).optional().transform((value) => (value === "" ? undefined : (value as z.infer<T> | undefined)));

const workerCategory = blankToUndefined(z.enum(WORKER_CATEGORIES));

/**
 * Who a new employment is for (E-04 §5, §88, §229):
 *
 *   MEMBER   somebody who already has a login in this company — their
 *            department and title are the membership's, as before;
 *   PERSON   somebody the group already knows (a former employee of another
 *            company, a hired candidate) — never a second person record;
 *   NEW      somebody with no login and no record yet: a construction worker,
 *            a driver — a person and an employment, and no account at all.
 */
export const EMPLOYEE_SUBJECTS = ["MEMBER", "PERSON", "NEW"] as const;

/**
 * A new employment record (PRD #16 §25, E-04 §229): its terms and where the
 * person will sit, which become the first row of its history (E-03 §8).
 */
export const createEmployeeProfileSchema = datesInOrder(
  z.object({
    subject: z.enum(EMPLOYEE_SUBJECTS).default("MEMBER"),
    companyMemberId: optionalId,
    personProfileId: optionalId,
    firstName: optionalText(80),
    lastName: optionalText(80),
    dateOfBirth: hrDate,
    workPhone: optionalText(40),
    personalPhone: optionalText(40),
    /** Set once HR has looked at the people it might be and says it is none of them (E-04 §92, §176). */
    confirmNewPerson: z.union([z.boolean(), z.literal("true"), z.literal("on"), z.literal("")]).optional().transform((value) => value === true || value === "true" || value === "on"),
    /** Where somebody without a membership sits; a member's come from the membership. */
    departmentId: optionalId,
    jobTitle: optionalText(160),
    workerCategory,
    tradeId: optionalId,
    employeeNumber: optionalText(60),
    employmentType: z.enum(EMPLOYMENT_TYPES, { message: "Choose an employment type" }),
    startDate: hrDate,
    probationEndDate: hrDate,
    endDate: hrDate,
    managerMemberId: optionalId,
    workLocationType: z.union([z.enum(["OFFICE", "SITE", "REMOTE", "HYBRID", "OTHER"]), z.literal("")]).optional().transform((value) => (value === "" ? undefined : value)),
    workLocation: optionalText(160),
    weeklyHours,
  }),
).superRefine((value, issue) => {
  if (value.subject === "MEMBER" && !value.companyMemberId) {
    issue.addIssue({ code: "custom", message: "Choose a team member", path: ["companyMemberId"] });
  }
  if (value.subject === "PERSON" && !value.personProfileId) {
    issue.addIssue({ code: "custom", message: "Choose the person", path: ["personProfileId"] });
  }
  if (value.subject === "NEW") {
    if (!value.firstName) issue.addIssue({ code: "custom", message: "Enter the first name", path: ["firstName"] });
    if (!value.lastName) issue.addIssue({ code: "custom", message: "Enter the last name", path: ["lastName"] });
  }
  // Probation is a stretch of the employment: it cannot end before it starts (AUD-09 §4, FV-07).
  if (value.startDate && value.probationEndDate && value.probationEndDate.getTime() < value.startDate.getTime()) {
    issue.addIssue({ code: "custom", message: "Probation cannot end before the employment starts.", path: ["probationEndDate"] });
  }
});

/**
 * The details of an employment that are not where somebody sits (E-03 §37,
 * §187; E-04 §156): its number, probation, its planned end, weekly hours, and
 * what kind of worker and which trade. Department, title, manager, location,
 * type, status and dates are changes with a date, made through the employment
 * change service and kept as history.
 */
export const updateEmployeeProfileSchema = z.object({
  /** Every field: absent leaves it as it is; empty or null clears it (AUD-09 §4, FV-05). */
  employeeNumber: clearableText(60, "Employee number"),
  workerCategory: z.union([z.enum(WORKER_CATEGORIES), z.literal(""), z.null()]).optional().transform((value) => (value === "" ? null : value)),
  tradeId: z.union([z.string().trim().max(64), z.null()]).optional().transform((value) => (value === "" ? null : value)),
  probationEndDate: dayField("clearable"),
  /** A running employment's planned end — a fixed term — not its history. */
  endDate: dayField("clearable"),
  weeklyHours: clearableWeeklyHours,
  versionUpdatedAt: optionalDate,
});

export type CreateEmployeeProfileInput = z.infer<typeof createEmployeeProfileSchema>;
export type UpdateEmployeeProfileInput = z.infer<typeof updateEmployeeProfileSchema>;

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
  /** With a login, without one, or with one switched off (E-04 §19, §20). */
  accountStatus: z.array(z.enum(["HAS_ACCOUNT", "NO_ACCOUNT", "ACCOUNT_SUSPENDED"])).optional(),
  workerCategory: z.array(z.enum(WORKER_CATEGORIES)).optional(),
  tradeId: z.string().optional(),
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
  effectiveFrom: dayField("required", "Enter the date the pay takes effect."),
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
  startDate: dayField("required", "Enter the first day."),
  endDate: dayField("required", "Enter the last day."),
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
    // HR may file leave on somebody's behalf — with or without a login; a
    // person filing their own leaves this empty and the service uses their own
    // employment (PRD #16 §191, E-04 §7).
    employeeId: optionalId,
    ...leaveFields,
  }),
);

/**
 * The reason may be medical and is shown only to the requester and to readers
 * holding `hr.leave.reason.view` (PRD #16 §95). So on an edit an absent reason
 * is left as it is — the form of a reader who cannot see it does not send one —
 * and empty or null clears it (AUD-09 §4, §5, FV-05, FV-10). The service
 * refuses a reason from a reader who cannot see it.
 */
export const updateLeaveSchema = leaveDatesInOrder(
  z.object({ ...leaveFields, reason: clearableText(2000, "Reason"), versionUpdatedAt: optionalDate }),
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
  employeeId: z.string().optional(),
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
  /** Whose day: an employment, with or without a login; empty is your own (E-04 §51). */
  employeeId: optionalId,
  date: dayField("required"),
  status: z.enum(ATTENDANCE_STATUSES, { message: "Choose a status" }),
  checkIn: timeOfDay,
  checkOut: timeOfDay,
  notes: optionalText(1000),
});

/** On an edit: absent leaves the time as it was; empty or null clears it (AUD-09 §4, FV-05). */
const clearableTimeOfDay = clearable(z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time such as 09:00"));

/**
 * Times belong to statuses that carry them: the form hides them for an absent
 * day and the service drops them for one, whatever is sent — the "clear"
 * policy for a hidden conditional field (AUD-09 §5, FV-10).
 */
export const updateAttendanceSchema = z.object({
  status: z.enum(ATTENDANCE_STATUSES),
  checkIn: clearableTimeOfDay,
  checkOut: clearableTimeOfDay,
  notes: clearableText(1000, "Notes"),
  versionUpdatedAt: optionalDate,
});

export type CreateAttendanceInput = z.infer<typeof createAttendanceSchema>;
export type UpdateAttendanceInput = z.infer<typeof updateAttendanceSchema>;

export const ATTENDANCE_SORT_KEYS = ["date-desc", "date-asc"] as const;
export type AttendanceSortKey = (typeof ATTENDANCE_SORT_KEYS)[number];

export const attendanceListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(ATTENDANCE_STATUSES)).optional(),
  employeeId: z.string().optional(),
  from: optionalDate,
  to: optionalDate,
  mine: z.boolean().default(false),
  exceptionsOnly: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.enum(ATTENDANCE_SORT_KEYS).default("date-desc"),
});

export type AttendanceListQuery = z.infer<typeof attendanceListQuerySchema>;
