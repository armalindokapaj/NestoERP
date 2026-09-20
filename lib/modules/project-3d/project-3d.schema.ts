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

export const project3DSlotCreateSchema = z.object({
  kind: z.enum(["MAP", "DETAIL"]).default("DETAIL"),
  role: z.enum(["BUILDING", "UNITS", "SURROUNDINGS", "CONTEXT", "CUSTOM"]),
  slotKey: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{1,63}$/, "Use a stable lowercase slot key."),
  displayName: z.string().trim().min(2).max(120),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  transformParentSlotId: z.string().trim().min(1).max(128).nullable().optional(),
  reason,
});

export const project3DUploadCreateSchema = z.object({
  fileName: z.string().trim().min(1).max(240).refine((value) => value.toLowerCase().endsWith(".glb"), "Upload a binary GLB file."),
  sizeBytes: z.number().int().positive().max(200 * 1024 * 1024),
  scale: z.number().positive().max(1000).default(1),
  rotationDeg: z.number().min(-36000).max(36000).default(0),
  altitudeOffset: z.number().min(-100000).max(100000).default(0),
  positionX: z.number().min(-100000).max(100000).default(0),
  positionZ: z.number().min(-100000).max(100000).default(0),
  rotationXDeg: z.number().min(-36000).max(36000).default(0),
  rotationZDeg: z.number().min(-36000).max(36000).default(0),
  reason,
});

export const project3DUploadCompleteSchema = z.object({ reason });

const project3DUnitBindingSchema = z.object({
  meshName: z.string().trim().min(1).max(500),
  projectUnitId: z.string().trim().min(1).max(128),
  mappingStatus: z.enum(["MAPPED", "CARRIED", "NEEDS_REVIEW"]).default("MAPPED"),
  poiYawDeg: z.number().min(-36000).max(36000).default(0),
  poiEnabled: z.boolean().default(true),
  poiDistanceOverride: z.number().positive().max(100000).nullable().default(null),
  poiHeightOverride: z.number().min(-100000).max(100000).nullable().default(null),
});

export const project3DUnitBindingsReplaceSchema = z.object({
  bindings: z.array(project3DUnitBindingSchema).max(10_000),
  reason,
});

export type Project3DSlotCreate = z.infer<typeof project3DSlotCreateSchema>;
export type Project3DUploadCreate = z.infer<typeof project3DUploadCreateSchema>;
export type Project3DUnitBindingsReplace = z.infer<typeof project3DUnitBindingsReplaceSchema>;
