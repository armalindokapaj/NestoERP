import { z } from "zod";

import { isLocalDate } from "@/lib/modules/calendar/calendar.time";
import { MINUTES_PER_DAY, MIN_ENTRY_MINUTES } from "./timesheet.time";
import { TIMESHEET_STATUSES, WORK_LOG_TYPES } from "./timesheet.types";

/**
 * Timesheet validation (PRD #42 §155-§161, §241).
 *
 * The member is never in a payload: every "my" endpoint acts for the signed-in
 * member (§232). Duration arrives as whole minutes — the browser parses what
 * was typed, the server refuses anything that is not a whole, positive,
 * single-day number.
 */

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const localDate = z.string().refine(isLocalDate, "Use a date in the form YYYY-MM-DD.");
const optionalId = z
  .string()
  .regex(ID)
  .nullable()
  .optional()
  .transform((value) => value ?? null);

export const workLogInputSchema = z.object({
  workDate: localDate,
  workType: z.enum(WORK_LOG_TYPES),
  projectId: optionalId,
  taskId: optionalId,
  minutes: z.number().int("Time is recorded in whole minutes.").min(MIN_ENTRY_MINUTES, `An entry is at least ${MIN_ENTRY_MINUTES} minutes.`).max(MINUTES_PER_DAY, "An entry cannot be longer than a day."),
  description: z
    .string()
    .trim()
    .max(2000, "Keep the description under 2,000 characters.")
    .nullable()
    .optional()
    .transform((value) => value || null),
  billable: z.boolean().optional(),
  overtimeFlag: z.boolean().optional().default(false),
});

export type WorkLogInput = z.infer<typeof workLogInputSchema>;

export const workLogUpdateSchema = workLogInputSchema.extend({ updatedAt: z.string().datetime().optional() });
export type WorkLogUpdateInput = z.infer<typeof workLogUpdateSchema>;

/** One grid cell: the row it belongs to, the day, and the new total for that row that day (§47). */
export const cellInputSchema = z.object({
  workDate: localDate,
  workType: z.enum(WORK_LOG_TYPES),
  projectId: optionalId,
  taskId: optionalId,
  minutes: z.number().int().min(0).max(MINUTES_PER_DAY),
});
export type CellInput = z.infer<typeof cellInputSchema>;

export const weekQuerySchema = z.object({
  week: localDate.optional(),
});

export const submitSchema = z.object({
  expectedVersion: z.number().int().min(1),
  /** The member saw "below the expected week" and submits anyway (§68). */
  acknowledgeShortfall: z.boolean().optional().default(false),
});

export const reopenSchema = z.object({
  note: z.string().trim().min(3, "Say why it is being reopened.").max(2000),
});

export const copyWeekSchema = z.object({
  week: localDate,
  withDurations: z.boolean().optional().default(false),
});

export const copyDaySchema = z.object({
  from: localDate,
  to: localDate,
});

export const teamQuerySchema = z.object({
  week: localDate.optional(),
  status: z.enum([...TIMESHEET_STATUSES, "NOT_STARTED"]).optional().catch(undefined),
  departmentId: z.string().regex(ID).optional().catch(undefined),
  memberId: z.string().regex(ID).optional().catch(undefined),
  approverMemberId: z.string().regex(ID).optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
});

export const projectSummaryQuerySchema = z.object({
  projectId: z.string().regex(ID).optional().catch(undefined),
  from: localDate.optional().catch(undefined),
  to: localDate.optional().catch(undefined),
  memberId: z.string().regex(ID).optional().catch(undefined),
  taskId: z.string().regex(ID).optional().catch(undefined),
  billable: z.enum(["all", "billable", "non_billable"]).catch("all").default("all"),
  /** Reporting reads approved time unless asked otherwise (§170). */
  include: z.enum(["approved", "all"]).catch("approved").default("approved"),
});

/** Reads the project summary filters from a URL, for a page or a route alike. */
export function parseProjectSummaryQuery(params: URLSearchParams | Record<string, string | string[] | undefined>, projectId?: string) {
  const get = (key: string) => {
    if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return projectSummaryQuerySchema.parse({
    projectId: projectId ?? get("projectId"),
    from: get("from"),
    to: get("to"),
    memberId: get("memberId"),
    taskId: get("taskId"),
    billable: get("billable"),
    include: get("include"),
  });
}

export const settingsSchema = z
  .object({
    weekStartsOn: z.number().int().min(1).max(7),
    standardDailyMinutes: z.number().int().min(60).max(MINUTES_PER_DAY),
    standardWeeklyMinutes: z.number().int().min(60).max(7 * MINUTES_PER_DAY),
    incrementMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60)]),
    enforceIncrement: z.boolean(),
    backdateDays: z.number().int().min(0).max(366),
    submitDay: z.number().int().min(1).max(7).nullable(),
    submitTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time in the form HH:MM.")
      .nullable(),
    descriptionsRequired: z.boolean(),
    membersSetBillable: z.boolean(),
  })
  .refine((value) => (value.submitDay === null) === (value.submitTime === null), { message: "Set both the deadline day and time, or neither.", path: ["submitTime"] });
export type TimesheetSettingsInput = z.infer<typeof settingsSchema>;

export const approverAssignmentSchema = z.object({
  memberId: z.string().regex(ID),
  approverMemberId: z.string().regex(ID).nullable(),
});
