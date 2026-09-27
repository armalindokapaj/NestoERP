import {
  MeetingActionItemStatus,
  MeetingAgendaItemStatus,
  MeetingAttendanceStatus,
  MeetingLocationType,
  MeetingStatus,
  MeetingType,
  MeetingVisibility,
} from "@prisma/client";
import { z } from "zod";

import { isLocalDate, isLocalTime } from "@/lib/modules/calendar/calendar.time";

/**
 * Meetings validation (PRD #40 §169-§177, §238).
 *
 * Times arrive as a local date and wall-clock start and end in the company's
 * zone, exactly as the calendar takes them, and the service turns them into
 * instants. Every limit here is the PRD's recommended one.
 */

export const TITLE_MAX = 180;
export const DESCRIPTION_MAX = 5_000;
export const LOCATION_MAX = 200;
export const ONLINE_URL_MAX = 500;
export const AGENDA_TITLE_MAX = 180;
export const AGENDA_DESCRIPTION_MAX = 5_000;
export const AGENDA_ITEMS_MAX = 50;
export const MINUTES_TITLE_MAX = 180;
export const MINUTES_BODY_MAX = 50_000;
export const MINUTES_SECTIONS_MAX = 30;
export const DECISION_TITLE_MAX = 300;
export const DECISION_DESCRIPTION_MAX = 10_000;
export const ACTION_TITLE_MAX = 180;
export const ACTION_DESCRIPTION_MAX = 5_000;
export const PARTICIPANTS_MAX = 250;
export const MAX_DURATION_MINUTES = 24 * 60;
export const CANCEL_REASON_MAX = 1_000;
export const REOPEN_REASON_MAX = 1_000;
/** Occurrences a new series may create at once, whatever the horizon (PRD #40 §226, §230). */
export const SERIES_OCCURRENCES_MAX = 100;
export const REMINDER_PRESETS = [0, 10, 15, 30, 60, 1_440] as const;
export const DEFAULT_REMINDER_MINUTES = 30;

const localDate = z.string().trim().refine(isLocalDate, { message: "Use a date in the form YYYY-MM-DD." });
const localTime = z.string().trim().refine(isLocalTime, { message: "Use a time in the form HH:MM." });
const id = z.string().trim().min(1).max(64);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max.toLocaleString("en")} characters.`)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));

/**
 * Only an https link to somewhere (PRD #40 §238). `javascript:`, `data:` and
 * plain http are refused, and so is anything with credentials in it.
 */
export function isSafeMeetingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

const onlineUrl = z
  .string()
  .trim()
  .max(ONLINE_URL_MAX)
  .optional()
  .nullable()
  .transform((value) => (value ? value : null))
  .refine((value) => value === null || isSafeMeetingUrl(value), { message: "Use an https:// meeting link." });

export const meetingRecurrenceSchema = z
  .object({
    frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
    interval: z.coerce.number().int().min(1).max(12).default(1),
    until: localDate.optional(),
    count: z.coerce.number().int().min(2).max(SERIES_OCCURRENCES_MAX).optional(),
  })
  .refine((value) => !(value.until && value.count), { message: "End a series by date or by count, not both." });
export type MeetingRecurrence = z.infer<typeof meetingRecurrenceSchema>;

const scheduleFields = {
  date: localDate,
  startTime: localTime,
  endTime: localTime,
};

const meetingFields = {
  title: z.string().trim().min(1, "Give the meeting a title.").max(TITLE_MAX, `Keep the title under ${TITLE_MAX} characters.`),
  description: optionalText(DESCRIPTION_MAX),
  meetingType: z.nativeEnum(MeetingType),
  visibility: z.nativeEnum(MeetingVisibility),
  ...scheduleFields,
  projectId: id.optional().nullable(),
  departmentId: id.optional().nullable(),
  locationType: z.nativeEnum(MeetingLocationType).default("UNSPECIFIED"),
  locationText: optionalText(LOCATION_MAX),
  onlineUrl,
};

function timeProblem(value: { startTime: string; endTime: string }): string | null {
  if (value.endTime <= value.startTime) return "The meeting must end after it starts.";
  return null;
}

function refineMeeting(
  value: { visibility: MeetingVisibility; projectId?: string | null; departmentId?: string | null; startTime: string; endTime: string },
  ctx: z.RefinementCtx,
) {
  const problem = timeProblem(value);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ["endTime"] });
  if (value.visibility === "PROJECT" && !value.projectId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose the project this meeting belongs to.", path: ["projectId"] });
  }
  if (value.visibility === "DEPARTMENT" && !value.departmentId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose the department this meeting belongs to.", path: ["departmentId"] });
  }
}

export const participantInputSchema = z.object({
  memberId: id,
  role: z.enum(["CHAIR", "SECRETARY", "ATTENDEE", "OBSERVER"]).default("ATTENDEE"),
  required: z.boolean().default(true),
});

export const createMeetingSchema = z
  .object({
    ...meetingFields,
    participants: z.array(participantInputSchema).max(PARTICIPANTS_MAX, `A meeting can have at most ${PARTICIPANTS_MAX} participants.`).default([]),
    agendaTemplate: z.string().trim().max(40).optional().nullable(),
    reminders: z
      .array(z.coerce.number().int().refine((value) => (REMINDER_PRESETS as readonly number[]).includes(value), { message: "Choose one of the reminder options." }))
      .max(3)
      .default([DEFAULT_REMINDER_MINUTES]),
    recurrence: meetingRecurrenceSchema.optional().nullable(),
    /** Save without inviting anybody yet (PRD #40 §102 DRAFT). */
    saveAsDraft: z.boolean().default(false),
  })
  .superRefine(refineMeeting);
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

/**
 * An optional text an edit may leave out (AUD-09 §4, FV-05): absent keeps
 * the saved value, `""`/`null` clears it. The create form's `optionalText`
 * turns absence into `null`, which on an edit would erase.
 */
const keptText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max.toLocaleString("en")} characters.`)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value ? value : null));

/**
 * A meeting edit (PRD #40 §178, AUD-09 §4, FV-05, FV-10). The title, type,
 * visibility and the schedule are always sent whole — the times only mean
 * something with their date. Everything optional may be left out and then
 * keeps its saved value: the location type no longer falls back to
 * "Unspecified", and an absent description, place, link, project or
 * department is no longer erased. `null` clears. The form sends every field,
 * and clears the location it hides only because the person changed the
 * location type — an intentional change (AUD-09 §5).
 */
export const updateMeetingSchema = z
  .object({
    ...meetingFields,
    description: keptText(DESCRIPTION_MAX),
    locationType: z.nativeEnum(MeetingLocationType).optional(),
    locationText: keptText(LOCATION_MAX),
    onlineUrl: keptText(ONLINE_URL_MAX).refine((value) => !value || isSafeMeetingUrl(value), { message: "Use an https:// meeting link." }),
    /** The version the form was loaded with (PRD #40 §178, §179). */
    version: z.coerce.number().int().min(1),
    /** For an occurrence of a series: this meeting, or this one and every later one (PRD #40 §227). */
    scope: z.enum(["THIS", "FUTURE"]).default("THIS"),
  })
  .superRefine((value, ctx) => {
    const problem = timeProblem(value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ["endTime"] });
    // An explicit clear is judged here; an absent link is judged by the
    // service against the saved one.
    if (value.visibility === "PROJECT" && value.projectId === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose the project this meeting belongs to.", path: ["projectId"] });
    }
    if (value.visibility === "DEPARTMENT" && value.departmentId === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose the department this meeting belongs to.", path: ["departmentId"] });
    }
  });
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;

export const cancelMeetingSchema = z.object({
  reason: optionalText(CANCEL_REASON_MAX),
  scope: z.enum(["THIS", "FUTURE"]).default("THIS"),
});

export const duplicateMeetingSchema = z.object({
  date: localDate,
  startTime: localTime.optional(),
});

export const respondSchema = z.object({ response: z.enum(["ACCEPTED", "DECLINED", "TENTATIVE"]) });

export const addParticipantsSchema = z.object({
  participants: z.array(participantInputSchema).min(1).max(PARTICIPANTS_MAX),
});

export const updateParticipantSchema = z
  .object({
    role: z.enum(["CHAIR", "SECRETARY", "ATTENDEE", "OBSERVER"]).optional(),
    required: z.boolean().optional(),
    attendance: z.nativeEnum(MeetingAttendanceStatus).optional(),
  })
  .refine((value) => value.role !== undefined || value.required !== undefined || value.attendance !== undefined, {
    message: "Nothing to change.",
  });

export const transferOrganizerSchema = z.object({ memberId: id });

export const agendaItemSchema = z.object({
  title: z.string().trim().min(1, "Give the item a title.").max(AGENDA_TITLE_MAX),
  description: optionalText(AGENDA_DESCRIPTION_MAX),
  presenterMemberId: id.optional().nullable(),
  plannedMinutes: z.coerce.number().int().min(1).max(MAX_DURATION_MINUTES).optional().nullable(),
});

export const updateAgendaItemSchema = agendaItemSchema.partial().extend({
  status: z.nativeEnum(MeetingAgendaItemStatus).optional(),
});

export const reorderSchema = z.object({ itemIds: z.array(id).min(1).max(AGENDA_ITEMS_MAX) });

export const applyTemplateSchema = z.object({ template: z.string().trim().min(1).max(40) });

export const minutesSectionSchema = z.object({
  title: z.string().trim().min(1, "Give the section a title.").max(MINUTES_TITLE_MAX),
  body: z.string().max(MINUTES_BODY_MAX, `A section can hold at most ${MINUTES_BODY_MAX.toLocaleString("en")} characters.`).default(""),
});

export const updateMinutesSectionSchema = minutesSectionSchema.partial();

export const reopenMinutesSchema = z.object({
  reason: z.string().trim().min(3, "Say why the minutes are being reopened.").max(REOPEN_REASON_MAX),
});

export const decisionSchema = z.object({
  title: z.string().trim().min(1, "Say what was decided.").max(DECISION_TITLE_MAX),
  description: optionalText(DECISION_DESCRIPTION_MAX),
});

export const updateDecisionSchema = decisionSchema.partial();

export const actionItemSchema = z.object({
  title: z.string().trim().min(1, "Say what needs doing.").max(ACTION_TITLE_MAX),
  description: optionalText(ACTION_DESCRIPTION_MAX),
  ownerMemberId: id.optional().nullable(),
  dueDate: localDate.optional().nullable(),
  /** Create the canonical Task at the same time (PRD #40 §107). */
  createTask: z.boolean().default(false),
});

export const updateActionItemSchema = z
  .object({
    title: z.string().trim().min(1).max(ACTION_TITLE_MAX).optional(),
    // Optional outside the transform, so leaving a field out keeps it.
    description: optionalText(ACTION_DESCRIPTION_MAX).optional(),
    ownerMemberId: id.optional().nullable(),
    dueDate: localDate.optional().nullable(),
    status: z.nativeEnum(MeetingActionItemStatus).optional(),
  });

const list = <T extends z.ZodTypeAny>(item: T) =>
  z
    .union([z.array(item), item])
    .optional()
    .transform((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]));

export const MEETING_SECTIONS = ["upcoming", "mine", "past", "all"] as const;

export const meetingListQuerySchema = z.object({
  section: z.enum(MEETING_SECTIONS).default("upcoming"),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  projectId: id.optional(),
  type: list(z.nativeEnum(MeetingType)),
  status: list(z.nativeEnum(MeetingStatus)),
  myOnly: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
  participantId: id.optional(),
  organizerId: id.optional(),
  q: z.string().trim().max(100).optional(),
  /**
   * A refinement of the Group workspace's list to one company (Workspace
   * Context §86, §87): checked against the companies the reader may open
   * Meetings in, and ignored in a company workspace.
   */
  company: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type MeetingListQuery = z.infer<typeof meetingListQuerySchema>;

export const actionListQuerySchema = z.object({
  mine: z.enum(["true", "false"]).optional().transform((value) => value !== "false"),
  status: z.enum(["open", "done", "all"]).default("open"),
  projectId: id.optional(),
  /** As on the meeting list: a Group-workspace refinement, never authority (Workspace Context §86, §87). */
  company: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ActionListQuery = z.infer<typeof actionListQuerySchema>;
