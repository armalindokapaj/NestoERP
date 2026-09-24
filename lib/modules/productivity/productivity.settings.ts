import type { z } from "zod";

import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { invalidateRequestScope, scoped } from "@/lib/core/observability/request-scope";
import { prisma } from "@/lib/database/prisma";
import type { productivitySettingsSchema } from "./productivity.schema";

/**
 * Company switches for announcements, favorites and recent work (PRD #45
 * §247). Created on first read with the PRD's defaults: everything on, recent
 * work kept for ninety days, acknowledgment reminders every three days, and
 * ordinary announcements left to the feed.
 */

export type ProductivitySettingsDTO = {
  announcementsEnabled: boolean;
  favoritesEnabled: boolean;
  recentWorkEnabled: boolean;
  recentWorkRetentionDays: number;
  announcementAckReminderDays: number;
  notifyNormalAnnouncements: boolean;
};

/**
 * Read once per company per request (NAV-02): the bell, search and the
 * dashboard each consult it several times, and every read is an upsert. The
 * next request reads it again.
 */
export function resolveProductivitySettings(companyId: string): Promise<ProductivitySettingsDTO> {
  return scoped(`productivity-settings:${companyId}`, () => readProductivitySettings(companyId));
}

async function readProductivitySettings(companyId: string): Promise<ProductivitySettingsDTO> {
  const row = await prisma.productivitySettings.upsert({ where: { companyId }, update: {}, create: { companyId } });
  return {
    announcementsEnabled: row.announcementsEnabled,
    favoritesEnabled: row.favoritesEnabled,
    recentWorkEnabled: row.recentWorkEnabled,
    recentWorkRetentionDays: row.recentWorkRetentionDays,
    announcementAckReminderDays: row.announcementAckReminderDays,
    notifyNormalAnnouncements: row.notifyNormalAnnouncements,
  };
}

/** The company's announcement authority changes these (Owner, Admin, CEO, HR, Company IT). */
export async function updateProductivitySettings(context: UserContext, input: z.infer<typeof productivitySettingsSchema>): Promise<ProductivitySettingsDTO> {
  if (!can(context, "announcement.manage_company")) throw new AccessError("FORBIDDEN", "You cannot change these settings.");
  const before = await resolveProductivitySettings(context.companyId);
  await prisma.$transaction(async (tx) => {
    await tx.productivitySettings.update({ where: { companyId: context.companyId }, data: { ...input, updatedByMemberId: context.membershipId } });
    await recordUserAction(context, { actionKey: AuditAction.PRODUCTIVITY_SETTINGS_UPDATED, entity: { type: "company", id: context.companyId, label: "Announcements, favorites and recent work" }, before: { ...before }, after: { ...input } }, { tx });
  });
  // The snapshot this request read is the old one (CTX-04).
  invalidateRequestScope(`productivity-settings:${context.companyId}`);
  return resolveProductivitySettings(context.companyId);
}
