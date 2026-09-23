import { z } from "zod";

import { NAVIGABLE_TYPES } from "./navigable.registry";

/** Validation for favorites, recent work and their settings (PRD #45 §180, §182, §290, §291). */

export const entityRefSchema = z.object({
  entityType: z.enum(NAVIGABLE_TYPES, { message: "That kind of record cannot be saved here." }),
  entityId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Unknown record."),
});

export const productivitySettingsSchema = z.object({
  announcementsEnabled: z.boolean(),
  favoritesEnabled: z.boolean(),
  recentWorkEnabled: z.boolean(),
  recentWorkRetentionDays: z.number().int().min(7, "Between 7 and 365 days.").max(365, "Between 7 and 365 days."),
  announcementAckReminderDays: z.number().int().min(1, "Between 1 and 30 days.").max(30, "Between 1 and 30 days."),
  notifyNormalAnnouncements: z.boolean(),
});

/** My Work query string (Fast Re-entry §61-§67, §167). Unknown or foreign values are dropped by the service, never trusted. */
export const myWorkQuerySchema = z.object({
  tab: z.enum(["recent", "favorites"]).default("recent"),
  companyId: z.string().max(64).optional(),
  module: z.string().max(40).optional(),
  projectId: z.string().max(64).optional(),
  q: z.string().max(200).optional(),
  range: z.enum(["today", "7d", "30d", "custom", "all"]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export function myWorkRange(input: z.infer<typeof myWorkQuerySchema>, now = new Date()): { since: Date | null; until: Date | null } {
  const days = { today: 0, "7d": 7, "30d": 30 } as const;
  if (input.range === "today" || input.range === "7d" || input.range === "30d") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - days[input.range]);
    return { since: start, until: null };
  }
  if (input.range === "custom") {
    return { since: input.from ? new Date(`${input.from}T00:00:00`) : null, until: input.to ? new Date(`${input.to}T23:59:59.999`) : null };
  }
  return { since: null, until: null };
}

export type EntityRef = z.infer<typeof entityRefSchema>;
