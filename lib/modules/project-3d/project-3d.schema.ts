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

export const project3DExperienceUpdateSchema = z.object({
  expectedRevision: z.number().int().positive(),
  config: z.record(z.string(), z.unknown()),
  reason,
});

const nodeOverrideSchema = z.object({
  nodeId: z.string().trim().min(1).max(256),
  classification: z.enum(["architecture", "landscape", "interaction", "helper"]).optional(),
  materialPreset: z.enum(["concrete", "plaster", "stone", "wood", "aluminium", "steel", "chrome", "ceramic"]).optional(),
  colorHex: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  roughness: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  opacity: z.number().min(0).max(1).optional(),
  clearcoat: z.number().min(0).max(1).optional(),
  clearcoatRoughness: z.number().min(0).max(1).optional(),
  iridescence: z.number().min(0).max(1).optional(),
  iridescenceIOR: z.number().min(1).max(2.333).optional(),
  visible: z.boolean().optional(),
  materialOverrideEnabled: z.boolean().optional(),
  baseTextureEnabled: z.boolean().optional(),
  roughnessMapEnabled: z.boolean().optional(),
  metalnessMapEnabled: z.boolean().optional(),
  normalMapEnabled: z.boolean().optional(),
  normalStrength: z.number().min(0).max(4).optional(),
  aoMapEnabled: z.boolean().optional(),
  emissiveEnabled: z.boolean().optional(),
  emissiveMapEnabled: z.boolean().optional(),
  emissiveColorHex: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  emissiveIntensity: z.number().min(0).max(20).optional(),
  transmissionEnabled: z.boolean().optional(),
  transmission: z.number().min(0).max(1).optional(),
  ior: z.number().min(1).max(2.333).optional(),
  thickness: z.number().min(0).max(100).optional(),
  attenuationEnabled: z.boolean().optional(),
  attenuationColorHex: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  attenuationDistance: z.number().min(0).max(100000).optional(),
  anisotropy: z.number().min(0).max(1).optional(),
  anisotropyRotation: z.number().min(-36000).max(36000).optional(),
  sheen: z.number().min(0).max(1).optional(),
  sheenColorHex: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  sheenRoughness: z.number().min(0).max(1).optional(),
  dispersion: z.number().min(0).max(1).optional(),
  textureTransformEnabled: z.boolean().optional(),
  mapScaleX: z.number().min(0.01).max(100).optional(),
  mapScaleY: z.number().min(0.01).max(100).optional(),
  mapOffsetX: z.number().min(-100).max(100).optional(),
  mapOffsetY: z.number().min(-100).max(100).optional(),
  mapRotation: z.number().min(-36000).max(36000).optional(),
});

export const project3DModelSettingsUpdateSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  scale: z.number().positive().max(1000),
  rotationDeg: z.number().min(-36000).max(36000),
  altitudeOffset: z.number().min(-100000).max(100000),
  positionX: z.number().min(-100000).max(100000),
  positionZ: z.number().min(-100000).max(100000),
  rotationXDeg: z.number().min(-36000).max(36000),
  rotationZDeg: z.number().min(-36000).max(36000),
  visible: z.boolean(),
  castShadow: z.boolean(),
  receiveShadow: z.boolean(),
  selectable: z.boolean(),
  transformLocked: z.boolean(),
  nodeOverrides: z.array(nodeOverrideSchema).max(10_000),
  reason,
});

export type Project3DSlotCreate = z.infer<typeof project3DSlotCreateSchema>;
export type Project3DUploadCreate = z.infer<typeof project3DUploadCreateSchema>;
export type Project3DUnitBindingsReplace = z.infer<typeof project3DUnitBindingsReplaceSchema>;
export type Project3DExperienceUpdate = z.infer<typeof project3DExperienceUpdateSchema>;
export type Project3DModelSettingsUpdate = z.infer<typeof project3DModelSettingsUpdateSchema>;
