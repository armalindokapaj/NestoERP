import { z } from "zod";

const reason = z.string().trim().min(3, "Give a reason for this action.").max(500);

export const project3DEntitlementUpdateSchema = z
  .object({
    status: z.enum(["INACTIVE", "ACTIVE", "SUSPENDED", "EXPIRED"]),
    viewerEnabled: z.boolean().default(true),
    planKey: z.string().trim().min(1).max(80).nullable().optional(),
    activatedAt: z.coerce.date().nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
    reason,
  })
  .refine((value) => !value.activatedAt || !value.expiresAt || value.expiresAt > value.activatedAt, {
    message: "Expiry must be after activation.",
    path: ["expiresAt"],
  });

export type Project3DEntitlementUpdate = z.infer<typeof project3DEntitlementUpdateSchema>;

