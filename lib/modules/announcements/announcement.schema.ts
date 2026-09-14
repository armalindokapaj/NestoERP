import { z } from "zod";

import { ANNOUNCEMENT_PRIORITIES, ANNOUNCEMENT_STATUSES, AUDIENCE_TYPES, BODY_MAX, FEED_TABS, TITLE_MAX } from "./announcement.types";

/**
 * Announcement validation (PRD #45 §18, §19, §156, §166, §289). Ids are shapes
 * only: that a project, department or member belongs to this company — and to
 * this author's reach — is the service's question (§157).
 */

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const id = z.string().regex(ID, "Unknown record.");
const instant = z
  .string()
  .datetime({ offset: true, message: "Use a valid date and time." })
  .transform((value) => new Date(value));
const optionalInstant = instant.optional().nullable().transform((value) => value ?? null);

const content = {
  title: z.string().trim().min(1, "Give it a title.").max(TITLE_MAX, `Keep the title under ${TITLE_MAX} characters.`),
  body: z.string().trim().min(1, "Write the announcement.").max(BODY_MAX, `Keep the body under ${BODY_MAX.toLocaleString("en")} characters.`),
  priority: z.enum(ANNOUNCEMENT_PRIORITIES).default("NORMAL"),
  audienceType: z.enum(AUDIENCE_TYPES).default("COMPANY"),
  projectId: id.optional().nullable().transform((value) => value ?? null),
  departmentId: id.optional().nullable().transform((value) => value ?? null),
  selectedMemberIds: z.array(id).max(500, "Choose at most 500 people.").default([]),
  expiresAt: optionalInstant,
  eventStartsAt: optionalInstant,
  eventEndsAt: optionalInstant,
  pinned: z.boolean().default(false),
  requiresAcknowledgment: z.boolean().default(false),
};

type Content = { audienceType: string; projectId: string | null; departmentId: string | null; selectedMemberIds: string[]; eventStartsAt: Date | null; eventEndsAt: Date | null };

function consistent(value: Content, ctx: z.RefinementCtx) {
  if (value.audienceType === "PROJECT" && !value.projectId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["projectId"], message: "Choose the project." });
  if (value.audienceType === "DEPARTMENT" && !value.departmentId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["departmentId"], message: "Choose the department." });
  if (value.audienceType === "SELECTED_MEMBERS" && value.selectedMemberIds.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedMemberIds"], message: "Choose at least one person." });
  if (value.eventEndsAt && !value.eventStartsAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["eventStartsAt"], message: "Give the event a start." });
  if (value.eventStartsAt && value.eventEndsAt && value.eventEndsAt < value.eventStartsAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["eventEndsAt"], message: "The event ends before it starts." });
}

export const createAnnouncementSchema = z.object(content).superRefine(consistent);
export const updateAnnouncementSchema = z.object({ ...content, expectedVersion: z.number().int().min(1) }).superRefine(consistent);

export const scheduleSchema = z.object({ expectedVersion: z.number().int().min(1), publishAt: instant });
export const versionSchema = z.object({ expectedVersion: z.number().int().min(1) });

export const feedQuerySchema = z.object({
  tab: z.enum(FEED_TABS).default("for_me"),
  priority: z.enum(ANNOUNCEMENT_PRIORITIES).optional(),
  audienceType: z.enum(AUDIENCE_TYPES).optional(),
  status: z.enum(ANNOUNCEMENT_STATUSES).optional(),
  projectId: id.optional(),
  departmentId: id.optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().regex(/^\d{1,6}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
export type FeedQuery = z.infer<typeof feedQuerySchema>;
