import { z } from "zod";

import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import {
  NOTIFICATION_CATEGORIES,
  notificationEventDefinitions,
  type NotificationCategory,
} from "./notification.events";

/**
 * Notification preferences (PRD #38 §78).
 *
 * One row per member per category, created only when somebody changes a
 * default. In-app is on by default for everything; email is off by default
 * except where the event registry says otherwise. A category holding a
 * mandatory event — a critical safety alert — cannot be switched off in-app.
 */

export type CategoryPreference = {
  category: NotificationCategory;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  /** In-app delivery cannot be turned off. */
  inAppLocked: boolean;
  /** No event in this category is ever emailed, so the switch is not offered. */
  emailAvailable: boolean;
};

export type DeliveryPreference = { inApp: boolean; email: boolean };

function categoryFacts(category: NotificationCategory) {
  const events = notificationEventDefinitions().filter((definition) => definition.category === category);
  return {
    inAppLocked: events.some((definition) => definition.mandatory),
    emailAvailable: events.some((definition) => definition.email),
    emailDefault: events.some((definition) => definition.email?.defaultOn),
  };
}

export async function listPreferences(context: UserContext): Promise<CategoryPreference[]> {
  const rows = await prisma.notificationPreference.findMany({
    where: { companyId: context.companyId, memberId: context.membershipId, category: { not: null } },
    select: { category: true, inAppEnabled: true, emailEnabled: true },
  });
  const byCategory = new Map(rows.map((row) => [row.category, row]));

  return NOTIFICATION_CATEGORIES.map((category) => {
    const facts = categoryFacts(category);
    const row = byCategory.get(category);
    return {
      category,
      inAppEnabled: facts.inAppLocked ? true : (row?.inAppEnabled ?? true),
      emailEnabled: facts.emailAvailable ? (row?.emailEnabled ?? facts.emailDefault) : false,
      inAppLocked: facts.inAppLocked,
      emailAvailable: facts.emailAvailable,
    };
  });
}

export const updatePreferenceSchema = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES),
  inAppEnabled: z.boolean(),
  emailEnabled: z.boolean(),
});

export async function updatePreference(
  context: UserContext,
  input: z.infer<typeof updatePreferenceSchema>,
): Promise<CategoryPreference> {
  const facts = categoryFacts(input.category);
  // The server enforces the lock; the switch being disabled in the page is a courtesy.
  const inAppEnabled = facts.inAppLocked ? true : input.inAppEnabled;
  const emailEnabled = facts.emailAvailable ? input.emailEnabled : false;

  await prisma.notificationPreference.upsert({
    where: {
      companyId_memberId_category: { companyId: context.companyId, memberId: context.membershipId, category: input.category },
    },
    update: { inAppEnabled, emailEnabled },
    create: { companyId: context.companyId, memberId: context.membershipId, category: input.category, inAppEnabled, emailEnabled },
  });

  return { category: input.category, inAppEnabled, emailEnabled, ...facts };
}

/**
 * What each recipient wants for one category — read in one query for a whole
 * batch of recipients, with the registry's defaults filling the gaps.
 */
export async function deliveryPreferences(
  companyId: string,
  memberIds: readonly string[],
  category: NotificationCategory,
): Promise<Map<string, DeliveryPreference>> {
  const facts = categoryFacts(category);
  const rows = await prisma.notificationPreference.findMany({
    where: { companyId, memberId: { in: [...memberIds] }, category },
    select: { memberId: true, inAppEnabled: true, emailEnabled: true },
  });
  const byMember = new Map(rows.map((row) => [row.memberId, row]));

  return new Map(
    memberIds.map((memberId) => {
      const row = byMember.get(memberId);
      return [
        memberId,
        {
          inApp: facts.inAppLocked ? true : (row?.inAppEnabled ?? true),
          email: facts.emailAvailable ? (row?.emailEnabled ?? facts.emailDefault) : false,
        },
      ];
    }),
  );
}
