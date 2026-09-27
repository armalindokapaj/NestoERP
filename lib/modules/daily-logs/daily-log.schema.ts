import { z } from "zod";

import { isLocalDate, isLocalTime } from "@/lib/modules/calendar/calendar.time";
import {
  DAILY_LOG_STATUSES,
  DELAY_CATEGORIES,
  DELAY_IMPACTS,
  DOCUMENT_CATEGORIES,
  EQUIPMENT_STATUSES,
  SITE_CONDITIONS,
  TASK_LINK_TYPES,
  WEATHER_CONDITIONS,
} from "./daily-log.types";

/**
 * Daily log validation (PRD #43 §184-§191).
 *
 * Times of day arrive as the site's wall clock ("07:30") and belong to the
 * log's work date in the company's zone; the service turns them into instants.
 * A delivery may carry its own date, and one on another day is flagged rather
 * than refused (§190). Ids are shapes only: whether a supplier, order, receipt,
 * task or member belongs to this company and this reader is the service's
 * question (§191).
 */

export const TEXT_MAX = 200;
export const NOTE_MAX = 5_000;
export const REASON_MAX = 2_000;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const localDate = z.string().trim().refine(isLocalDate, { message: "Use a date in the form YYYY-MM-DD." });
const localTime = z.string().trim().refine(isLocalTime, { message: "Use a time in the form HH:MM." });
const optionalTime = localTime.optional().nullable().transform((value) => value ?? null);
const optionalId = z.string().regex(ID).optional().nullable().transform((value) => value ?? null);
const text = (max = TEXT_MAX, message = "Required.") => z.string().trim().min(1, message).max(max, `Keep this under ${max.toLocaleString("en")} characters.`);
const optionalText = (max = TEXT_MAX) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max.toLocaleString("en")} characters.`)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));
const optionalNumber = (min: number, max: number, message: string) => z.number().min(min, message).max(max, message).optional().nullable().transform((value) => value ?? null);
const expected = { updatedAt: z.string().datetime().optional() };

export const createDailyLogSchema = z.object({
  projectId: z.string().regex(ID),
  workDate: localDate,
});

/**
 * A header field an edit may leave out (AUD-09 §4, FV-05): absent keeps the
 * saved value, `""`/`null` clears it. `optionalText` above turns absence into
 * `null`, which on the header's PATCH erased every note the request did not
 * repeat.
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
 * The log's own notes (PRD #43 §184): a partial update. The workspace sends
 * them all; a request that names only the summary changes only the summary.
 */
export const updateDailyLogSchema = z.object({
  expectedVersion: z.number().int().min(1),
  summary: keptText(NOTE_MAX),
  generalNotes: keptText(NOTE_MAX),
  delaySummary: keptText(NOTE_MAX),
  instructionSummary: keptText(NOTE_MAX),
  weatherSummary: keptText(1_000),
  siteCondition: z.enum(SITE_CONDITIONS).nullable().optional(),
  siteConditionNotes: keptText(1_000),
});
export type UpdateDailyLogInput = z.infer<typeof updateDailyLogSchema>;

export const weatherSchema = z.object({
  observedTime: localTime,
  temperatureC: optionalNumber(-60, 70, "Enter a temperature between -60 and 70 °C."),
  condition: z.enum(WEATHER_CONDITIONS).optional().nullable().transform((value) => value ?? null),
  precipitationMm: optionalNumber(0, 2_000, "Enter rainfall between 0 and 2,000 mm."),
  windKph: optionalNumber(0, 500, "Enter a wind speed between 0 and 500 km/h."),
  humidityPct: z.number().int().min(0).max(100, "Humidity is a percentage.").optional().nullable().transform((value) => value ?? null),
  notes: optionalText(1_000),
  ...expected,
});

export const workforceSchema = z.object({
  organizationName: text(TEXT_MAX, "Name the company or crew."),
  supplierId: optionalId,
  /** The contractor and work package the crew worked for (PRD #46 §142). */
  contractorId: optionalId,
  workPackageId: optionalId,
  trade: optionalText(),
  crewName: optionalText(),
  /** One of the company's own crews on this project, when the entry was taken from the workforce (E-04 §43, §182). */
  crewId: optionalId,
  headcount: z.number().int("Headcount is a whole number.").min(1, "Headcount is at least 1.").max(10_000, "Headcount is at most 10,000."),
  notes: optionalText(1_000),
  ...expected,
});

export const activitySchema = z.object({
  title: text(TEXT_MAX, "Say what was done."),
  description: optionalText(NOTE_MAX),
  projectArea: optionalText(),
  floorZone: optionalText(),
  trade: optionalText(),
  progressPercent: optionalNumber(0, 100, "Progress is between 0 and 100%."),
  linkedTaskId: optionalId,
  /** Whose work it was, on which work package (PRD #46 §143). */
  contractorId: optionalId,
  workPackageId: optionalId,
  ...expected,
});

export const equipmentSchema = z.object({
  equipmentName: text(TEXT_MAX, "Name the equipment."),
  equipmentCode: optionalText(80),
  supplierId: optionalId,
  quantity: z.number().int("Quantity is a whole number.").min(1, "Quantity is at least 1.").max(10_000),
  hoursUsed: optionalNumber(0, 24 * 10_000, "Enter the hours used."),
  status: z.enum(EQUIPMENT_STATUSES).optional().nullable().transform((value) => value ?? null),
  notes: optionalText(1_000),
  ...expected,
});

export const deliverySchema = z.object({
  description: text(TEXT_MAX, "Say what arrived."),
  supplierId: optionalId,
  purchaseOrderId: optionalId,
  goodsReceiptId: optionalId,
  inventoryReceiptId: optionalId,
  quantityText: optionalText(),
  deliveredDate: localDate.optional().nullable().transform((value) => value ?? null),
  deliveredTime: optionalTime,
  conditionNote: optionalText(1_000),
  notes: optionalText(1_000),
  ...expected,
});

export const visitorSchema = z
  .object({
    name: text(TEXT_MAX, "Name the visitor."),
    organization: optionalText(),
    purpose: optionalText(),
    arrivedTime: optionalTime,
    departedTime: optionalTime,
    escortedByMemberId: optionalId,
    notes: optionalText(1_000),
    ...expected,
  })
  .refine((value) => !value.arrivedTime || !value.departedTime || value.departedTime >= value.arrivedTime, { message: "Departure cannot be before arrival.", path: ["departedTime"] });

export const delaySchema = z
  .object({
    category: z.enum(DELAY_CATEGORIES),
    title: text(TEXT_MAX, "Say what held the work up."),
    description: optionalText(NOTE_MAX),
    startedTime: optionalTime,
    endedTime: optionalTime,
    durationMinutes: z.number().int().min(1, "A delay lasts at least a minute.").max(24 * 60, "A delay on one log lasts at most a day.").optional().nullable().transform((value) => value ?? null),
    responsiblePartyText: optionalText(),
    impact: z.enum(DELAY_IMPACTS).optional().nullable().transform((value) => value ?? null),
    linkedTaskId: optionalId,
    ...expected,
  })
  .refine((value) => !value.startedTime || !value.endedTime || value.endedTime > value.startedTime, { message: "The end is after the start.", path: ["endedTime"] });

export const instructionSchema = z.object({
  title: text(TEXT_MAX, "Give the instruction a title."),
  description: text(NOTE_MAX, "Record what was instructed."),
  issuedByText: optionalText(),
  issuedByMemberId: optionalId,
  recipientText: optionalText(),
  issuedTime: optionalTime,
  requiresAction: z.boolean().optional().default(false),
  linkedTaskId: optionalId,
  ...expected,
});

export const SECTION_SCHEMAS = {
  weather: weatherSchema,
  workforce: workforceSchema,
  activities: activitySchema,
  equipment: equipmentSchema,
  deliveries: deliverySchema,
  visitors: visitorSchema,
  delays: delaySchema,
  instructions: instructionSchema,
} as const;

export const transitionSchema = z.object({ expectedVersion: z.number().int().min(1) });
export const reasonSchema = transitionSchema.extend({ reason: text(REASON_MAX, "Give a reason.") });
export const correctionSchema = z.object({
  reason: text(REASON_MAX, "Say why the record needs correcting."),
  correctionSummary: text(NOTE_MAX, "Record the correction."),
});

export const linkTaskSchema = z.object({ taskId: z.string().regex(ID), linkType: z.enum(TASK_LINK_TYPES).optional().default("RELATED") });
export const createTaskFromLogSchema = z.object({
  title: text(TEXT_MAX, "Give the task a title."),
  description: optionalText(NOTE_MAX),
  assigneeMemberId: optionalId,
  dueDate: localDate.optional().nullable().transform((value) => value ?? null),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional().default("MEDIUM"),
  linkType: z.enum(TASK_LINK_TYPES).optional().default("FOLLOW_UP"),
  /** The delay or instruction the task answers, so the entry points at it. */
  source: z.object({ section: z.enum(["delays", "instructions", "activities"]), entryId: z.string().regex(ID) }).optional(),
});

export const recordLinkSchema = z.object({ recordType: z.string().regex(/^[a-z_]{2,40}$/), recordId: z.string().regex(ID) });

export const evidenceMetaSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES),
  caption: optionalText(500),
  takenTime: optionalTime,
  sortOrder: z.number().int().min(0).max(10_000).optional().nullable().transform((value) => value ?? null),
});

export const listQuerySchema = z.object({
  projectId: z.string().regex(ID).optional().catch(undefined),
  from: localDate.optional().catch(undefined),
  to: localDate.optional().catch(undefined),
  status: z.enum(DAILY_LOG_STATUSES).optional().catch(undefined),
  authorId: z.string().regex(ID).optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).catch(25).default(25),
});
export type DailyLogListQuery = z.infer<typeof listQuerySchema>;

export const reportQuerySchema = z.object({
  projectId: z.string().regex(ID).optional().catch(undefined),
  from: localDate.optional().catch(undefined),
  to: localDate.optional().catch(undefined),
});

export const settingsSchema = z.object({
  logsRequired: z.boolean(),
  backdateDays: z.number().int().min(0).max(62),
  reviewerRequired: z.boolean(),
});

export const projectSettingsSchema = z.object({
  logsRequired: z.boolean().nullable(),
  reviewerMemberId: optionalId,
  workingDays: z.array(z.number().int().min(1).max(7)).max(7).transform((days) => [...new Set(days)].sort()),
});
