import { CalendarEventType, CalendarVisibility } from "@prisma/client";
import { z } from "zod";

import { FREQUENCIES, MAX_COUNT, MAX_INTERVAL, WEEKDAYS } from "./calendar.recurrence";
import { isLocalDate, isLocalTime } from "./calendar.time";
import { CALENDAR_CATEGORIES } from "./calendar.types";

/**
 * Calendar validation (PRD #39 §71, §72, §195, §196).
 *
 * Times arrive as local wall-clock values — a date and, for timed events, a
 * start and end time — and the service turns them into UTC instants in the
 * company zone. A browser in another zone therefore cannot shift an event by
 * sending its own idea of "09:00".
 */

export const TITLE_MAX = 180;
export const DESCRIPTION_MAX = 5_000;
export const LOCATION_MAX = 200;
export const PARTICIPANTS_MAX = 250;
export const REMINDERS_MAX = 3;
export const RANGE_MAX_DAYS = 93;
export const REMINDER_PRESETS = [0, 10, 30, 60, 1_440, 10_080] as const;

const localDate = z.string().trim().refine(isLocalDate, { message: "Use a date in the form YYYY-MM-DD." });
const localTime = z.string().trim().refine(isLocalTime, { message: "Use a time in the form HH:MM." });
const id = z.string().trim().min(1).max(64);

export const recurrenceSchema = z
  .object({
    frequency: z.enum(FREQUENCIES as [string, ...string[]]),
    interval: z.coerce.number().int().min(1).max(MAX_INTERVAL).default(1),
    byDay: z.array(z.enum(WEEKDAYS as [string, ...string[]])).max(7).optional(),
    until: localDate.optional(),
    count: z.coerce.number().int().min(1).max(MAX_COUNT).optional(),
  })
  .refine((value) => !(value.until && value.count), { message: "End a series by date or by count, not both." })
  .refine((value) => !value.byDay?.length || value.frequency === "WEEKLY", {
    message: "Days of the week apply only to a weekly series.",
  });

export const reminderSchema = z.object({
  minutesBefore: z.coerce
    .number()
    .int()
    .refine((value) => (REMINDER_PRESETS as readonly number[]).includes(value), { message: "Choose one of the reminder options." }),
  channel: z.enum(["IN_APP", "EMAIL"]).default("IN_APP"),
});

const eventFields = {
  title: z.string().trim().min(1, "Give the event a title.").max(TITLE_MAX),
  description: z.string().trim().max(DESCRIPTION_MAX).optional().nullable(),
  location: z.string().trim().max(LOCATION_MAX).optional().nullable(),
  eventType: z.nativeEnum(CalendarEventType),
  visibility: z.nativeEnum(CalendarVisibility),
  allDay: z.boolean().default(false),
  startDate: localDate,
  /** All-day: the last day, inclusive. Timed: the day the event ends. */
  endDate: localDate.optional(),
  startTime: localTime.optional(),
  endTime: localTime.optional(),
  projectId: id.optional().nullable(),
  departmentId: id.optional().nullable(),
  participantIds: z.array(id).max(PARTICIPANTS_MAX).default([]),
  reminders: z.array(reminderSchema).max(REMINDERS_MAX).default([]),
  recurrence: recurrenceSchema.optional().nullable(),
};

function timesProblem(value: { allDay: boolean; startDate: string; endDate?: string; startTime?: string; endTime?: string }): string | null {
  const endDate = value.endDate ?? value.startDate;
  if (endDate < value.startDate) return "The event cannot end before it starts.";
  if (!value.allDay) {
    if (!value.startTime) return "Choose a start time, or make it an all-day event.";
    if (value.endTime && endDate === value.startDate && value.endTime < value.startTime) {
      return "The event cannot end before it starts.";
    }
  }
  return null;
}

export const createEventSchema = z.object(eventFields).superRefine((value, ctx) => {
  const problem = timesProblem(value);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ["endDate"] });
  if (value.visibility === "PROJECT" && !value.projectId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose the project this event belongs to.", path: ["projectId"] });
  }
  if (value.visibility === "DEPARTMENT" && !value.departmentId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose the department this event belongs to.", path: ["departmentId"] });
  }
  if (value.visibility === "SELECTED_MEMBERS" && value.participantIds.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Add the people who should see this event.", path: ["participantIds"] });
  }
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

/** An edit replaces the event's fields; participants and reminders have their own endpoints. */
export const updateEventSchema = z
  .object({
    ...eventFields,
    participantIds: z.array(id).max(PARTICIPANTS_MAX).optional(),
    reminders: z.array(reminderSchema).max(REMINDERS_MAX).optional(),
    /** V0.1 edits the whole series (PRD #39 §80). */
    scope: z.literal("ENTIRE_SERIES").default("ENTIRE_SERIES"),
  })
  .superRefine((value, ctx) => {
    const problem = timesProblem(value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ["endDate"] });
    if (value.visibility === "PROJECT" && !value.projectId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose the project this event belongs to.", path: ["projectId"] });
    }
    if (value.visibility === "DEPARTMENT" && !value.departmentId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose the department this event belongs to.", path: ["departmentId"] });
    }
  });
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

/** Moving an event by drag: a new start, and the same duration unless resized (PRD #39 §82-§84). */
export const moveEventSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).optional(),
});

const list = <T extends z.ZodTypeAny>(item: T) =>
  z
    .union([z.array(item), item])
    .optional()
    .transform((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]));

export const rangeQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    providers: list(z.string().max(40)),
    categories: list(z.enum(CALENDAR_CATEGORIES)),
    projectIds: list(id),
    memberIds: list(id),
    myOnly: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
    includeAllDay: z.enum(["true", "false"]).optional().transform((value) => value !== "false"),
  })
  .superRefine((value, ctx) => {
    const from = new Date(value.from).getTime();
    const to = new Date(value.to).getTime();
    if (to <= from) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The range must end after it starts.", path: ["to"] });
    if (to - from > RANGE_MAX_DAYS * 86_400_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Ask for at most ${RANGE_MAX_DAYS} days at a time.`, path: ["to"] });
    }
  });
export type RangeQuery = z.infer<typeof rangeQuerySchema>;

export const availabilityQuerySchema = z
  .object({
    memberIds: list(id).refine((value) => Boolean(value?.length) && value!.length <= 50, { message: "Choose between 1 and 50 people." }),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    excludeEventId: id.optional(),
  })
  .superRefine((value, ctx) => {
    const from = new Date(value.from).getTime();
    const to = new Date(value.to).getTime();
    if (to <= from || to - from > 31 * 86_400_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ask for availability over at most 31 days.", path: ["to"] });
    }
  });

export const participantsSchema = z.object({ memberIds: z.array(id).min(1).max(PARTICIPANTS_MAX) });
export const respondSchema = z.object({ status: z.enum(["ACCEPTED", "DECLINED", "TENTATIVE"]) });
