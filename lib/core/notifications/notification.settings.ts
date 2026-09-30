import { z } from "zod";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import type { QuietHours } from "./push.quiet-hours";

/**
 * The person-level and project-level notification settings (MOB-10 §88-§94).
 * Quiet hours belong to the user, because one phone is carried between
 * companies; project levels belong to one membership in one company.
 */

const MINUTES = z.number().int().min(0).max(1439);

export const quietHoursSchema = z.object({
  enabled: z.boolean(),
  startMinute: MINUTES,
  endMinute: MINUTES,
  timezone: z.string().trim().min(1).max(64).refine(isTimeZone, "Unknown time zone."),
  allowCritical: z.boolean(),
});

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Until the person picks one (the page offers their device's), the company's zone, else UTC (§93). */
async function defaultTimeZone(context: UserContext): Promise<string> {
  const settings = await prisma.companySettings.findUnique({ where: { companyId: context.companyId }, select: { timezone: true } });
  return settings?.timezone && isTimeZone(settings.timezone) ? settings.timezone : "UTC";
}

export async function getQuietHours(context: UserContext): Promise<QuietHours> {
  const row = await prisma.notificationQuietHours.findUnique({ where: { userId: context.userId } });
  if (row) return { enabled: row.enabled, startMinute: row.startMinute, endMinute: row.endMinute, timezone: row.timezone, allowCritical: row.allowCritical };
  return { enabled: false, startMinute: 22 * 60, endMinute: 7 * 60, timezone: await defaultTimeZone(context), allowCritical: true };
}

export async function setQuietHours(context: UserContext, input: z.infer<typeof quietHoursSchema>): Promise<QuietHours> {
  await prisma.notificationQuietHours.upsert({
    where: { userId: context.userId },
    update: input,
    create: { userId: context.userId, ...input },
  });
  return input;
}

export type ProjectNotificationLevel = "ALL" | "IMPORTANT" | "MUTED";
export type ProjectPreferenceRow = { projectId: string; name: string; level: ProjectNotificationLevel };

/**
 * One row per project the person is an active member of. Subscriptions come
 * from membership, never from having once opened a project (§144).
 */
export async function listProjectPreferences(context: UserContext): Promise<ProjectPreferenceRow[]> {
  const memberships = await prisma.projectMember.findMany({
    where: { companyId: context.companyId, companyMemberId: context.membershipId, status: "ACTIVE" },
    select: { project: { select: { id: true, name: true } } },
    orderBy: { project: { name: "asc" } },
    take: 200,
  });
  const levels = await prisma.notificationProjectPreference.findMany({
    where: { companyId: context.companyId, memberId: context.membershipId },
    select: { projectId: true, level: true },
  });
  const levelOf = new Map(levels.map((row) => [row.projectId, row.level]));
  return memberships.map(({ project }) => ({ projectId: project.id, name: project.name, level: levelOf.get(project.id) ?? "ALL" }));
}

export const projectLevelSchema = z.object({ projectId: z.string().min(1), level: z.enum(["ALL", "IMPORTANT", "MUTED"]) });

export async function setProjectLevel(context: UserContext, input: z.infer<typeof projectLevelSchema>): Promise<ProjectPreferenceRow> {
  const membership = await prisma.projectMember.findFirst({
    where: { companyId: context.companyId, companyMemberId: context.membershipId, projectId: input.projectId, status: "ACTIVE" },
    select: { project: { select: { id: true, name: true } } },
  });
  // A project you are not on is simply not found; there is nothing to mute.
  if (!membership) throw new AccessError("NOT_FOUND");
  await prisma.notificationProjectPreference.upsert({
    where: { companyId_memberId_projectId: { companyId: context.companyId, memberId: context.membershipId, projectId: input.projectId } },
    update: { level: input.level },
    create: { companyId: context.companyId, memberId: context.membershipId, projectId: input.projectId, level: input.level },
  });
  return { projectId: membership.project.id, name: membership.project.name, level: input.level };
}
