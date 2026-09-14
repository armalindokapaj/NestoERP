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

export type EntityRef = z.infer<typeof entityRefSchema>;
