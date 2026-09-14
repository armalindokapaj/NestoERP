import { z } from "zod";

import { isLocalDate } from "@/lib/modules/calendar/calendar.time";
import { BLOCKER_SEVERITIES, MILESTONE_STATUSES, MILESTONE_TYPES, PHASE_STATUSES, TASK_LINK_TYPES } from "./planning.types";

/**
 * Planning validation (PRD #44 §197-§206). Ids are shapes only: whether a
 * phase, milestone, task, meeting, log or member belongs to this company and
 * this project is the service's question (§198, §199).
 */

export const NAME_MAX = 200;
export const TEXT_MAX = 5_000;
export const REASON_MAX = 2_000;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const idSchema = z.string().regex(ID, "Unknown record.");
const localDate = z.string().trim().refine(isLocalDate, { message: "Use a date in the form YYYY-MM-DD." });
const optionalDate = localDate.optional().nullable().transform((value) => value ?? null);
const optionalId = idSchema.optional().nullable().transform((value) => value ?? null);
const name = z.string().trim().min(1, "Give it a name.").max(NAME_MAX, `Keep this under ${NAME_MAX} characters.`);
const optionalText = (max = TEXT_MAX) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max.toLocaleString("en")} characters.`)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));
const progress = z.number().min(0, "Progress is between 0 and 100%.").max(100, "Progress is between 0 and 100%.").optional().nullable().transform((value) => value ?? null);
const expectedVersion = z.number().int().min(1);
const reason = z.string().trim().min(1, "Give a reason.").max(REASON_MAX, `Keep this under ${REASON_MAX.toLocaleString("en")} characters.`);
const optionalReason = optionalText(REASON_MAX);

/* Phases ------------------------------------------------------------------- */

const phaseFields = {
  name,
  description: optionalText(),
  status: z.enum(PHASE_STATUSES).default("NOT_STARTED"),
  progressPercent: progress,
  ownerMemberId: optionalId,
  plannedStartDate: optionalDate,
  plannedEndDate: optionalDate,
  forecastStartDate: optionalDate,
  forecastEndDate: optionalDate,
  actualStartDate: optionalDate,
  actualEndDate: optionalDate,
};

type PhaseDates = Record<"plannedStartDate" | "plannedEndDate" | "forecastStartDate" | "forecastEndDate" | "actualStartDate" | "actualEndDate", string | null>;

function phaseRanges(value: PhaseDates, ctx: z.RefinementCtx) {
  for (const [start, end] of [["plannedStartDate", "plannedEndDate"], ["forecastStartDate", "forecastEndDate"], ["actualStartDate", "actualEndDate"]] as const) {
    if (value[start] && value[end] && value[end]! < value[start]!) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [end], message: "The end is before the start." });
  }
}

export const createPhaseSchema = z.object(phaseFields).superRefine(phaseRanges);
export const updatePhaseSchema = z.object({ ...phaseFields, expectedVersion }).superRefine(phaseRanges);
export const reorderSchema = z.object({ ids: z.array(idSchema).min(1).max(1_000) });
export const reorderMilestonesSchema = z.object({ phaseId: optionalId, ids: z.array(idSchema).min(1).max(2_000) });

/* Milestones --------------------------------------------------------------- */

export const createMilestoneSchema = z.object({
  name,
  description: optionalText(),
  phaseId: optionalId,
  milestoneType: z.enum(MILESTONE_TYPES).default("OTHER"),
  ownerMemberId: optionalId,
  baselineDate: optionalDate,
  plannedDate: optionalDate,
  forecastDate: optionalDate,
  progressPercent: progress,
  critical: z.boolean().default(false),
  externallyCommitted: z.boolean().default(false),
});

/**
 * An edit never moves the baseline or completes the milestone: those are their
 * own commands with their own permission, reason and audit (§22, §30, §196).
 */
export const updateMilestoneSchema = z.object({
  expectedVersion,
  name,
  description: optionalText(),
  phaseId: optionalId,
  milestoneType: z.enum(MILESTONE_TYPES),
  /** Completing and reopening are their own commands; the service refuses either through an edit. */
  status: z.enum(MILESTONE_STATUSES),
  ownerMemberId: optionalId,
  plannedDate: optionalDate,
  forecastDate: optionalDate,
  progressPercent: progress,
  critical: z.boolean(),
  externallyCommitted: z.boolean(),
  /** A historical correction of a completed milestone's actual date (§200). */
  actualDate: optionalDate,
  /** Why the forecast moved, kept with the change (§247). */
  forecastReason: optionalReason,
});

/** The mobile quick update: status, forecast, progress (§119, §247). */
export const quickUpdateSchema = z
  .object({
    expectedVersion,
    status: z.enum(MILESTONE_STATUSES).optional(),
    forecastDate: localDate.nullable().optional(),
    progressPercent: z.number().min(0).max(100).nullable().optional(),
    forecastReason: optionalReason,
  })
  .refine((value) => value.status !== "COMPLETED", { path: ["status"], message: "Use Mark complete to complete a milestone." });

export const completeMilestoneSchema = z.object({
  expectedVersion,
  actualDate: optionalDate,
  completionNote: optionalText(REASON_MAX),
});

export const reopenMilestoneSchema = z.object({ expectedVersion, reason });

export const baselineSchema = z.object({
  expectedVersion,
  newBaselineDate: localDate,
  reason: optionalReason,
});

export const archiveSchema = z.object({ expectedVersion: expectedVersion.optional() });

export const milestoneListSchema = z.object({
  phaseId: idSchema.optional(),
  status: z.enum(MILESTONE_STATUSES).optional(),
  ownerId: idSchema.optional(),
  critical: z
    .union([z.boolean(), z.enum(["1", "0", "true", "false"])])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === true || value === "1" || value === "true")),
  from: localDate.optional(),
  to: localDate.optional(),
  q: z.string().trim().max(100).optional(),
  quick: z.enum(["upcoming", "delayed", "at_risk", "critical", "completed"]).optional(),
});

/* Dependencies ------------------------------------------------------------- */

export const dependencySchema = z.object({
  /** The milestone this one waits on (§159). */
  predecessorMilestoneId: idSchema,
  lagDays: z.number().int("Lag is whole days.").min(0, "Lag cannot be negative.").max(3_650).default(0),
});

/* Blockers ----------------------------------------------------------------- */

export const createBlockerSchema = z.object({
  title: name,
  description: optionalText(),
  severity: z.enum(BLOCKER_SEVERITIES).default("MEDIUM"),
  ownerMemberId: optionalId,
  dueDate: optionalDate,
  /** Raise a task for the blocker through the task service (§154, §155). */
  createTask: z.boolean().default(false),
});

export const updateBlockerSchema = z.object({
  title: name,
  description: optionalText(),
  severity: z.enum(BLOCKER_SEVERITIES),
  ownerMemberId: optionalId,
  dueDate: optionalDate,
});

export const resolveBlockerSchema = z.object({ resolutionNote: optionalText(REASON_MAX) });

/* Links -------------------------------------------------------------------- */

export const linkTaskSchema = z.object({ taskId: idSchema, linkType: z.enum(TASK_LINK_TYPES).default("SUPPORTS") });

export const createTaskFromMilestoneSchema = z.object({
  title: name,
  description: optionalText(),
  assigneeMemberId: optionalId,
  dueDate: optionalDate,
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  linkType: z.enum(TASK_LINK_TYPES).default("SUPPORTS"),
});

export const recordLinkSchema = z.object({ recordId: idSchema });

/* Templates, copy and settings --------------------------------------------- */

export const applyTemplateSchema = z.object({ templateKey: z.string().trim().min(1).max(64) });
export const copyPlanningSchema = z.object({ sourceProjectId: idSchema });

export const projectPlanningSettingsSchema = z.object({ baselineLocked: z.boolean() });

export const planningSettingsSchema = z.object({
  milestoneReminderDays: z.number().int().min(1, "Between 1 and 60 days.").max(60, "Between 1 and 60 days."),
  baselineChangeReasonRequired: z.boolean(),
  notifyExecutivesOnCriticalChanges: z.boolean(),
});

export const reportQuerySchema = z.object({
  projectId: idSchema.optional(),
  phaseId: idSchema.optional(),
  status: z.enum(MILESTONE_STATUSES).optional(),
  ownerId: idSchema.optional(),
  critical: z
    .union([z.boolean(), z.enum(["1", "0", "true", "false"])])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === true || value === "1" || value === "true")),
  from: localDate.optional(),
  to: localDate.optional(),
});

export type CreatePhaseInput = z.infer<typeof createPhaseSchema>;
export type UpdatePhaseInput = z.infer<typeof updatePhaseSchema>;
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>;
export type QuickUpdateInput = z.infer<typeof quickUpdateSchema>;
export type MilestoneListQuery = z.infer<typeof milestoneListSchema>;
export type ReportQuery = z.infer<typeof reportQuerySchema>;
