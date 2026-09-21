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

export const project3DExperienceCreateSchema = z.object({
  parentGroupId: z.string().trim().min(1).max(128),
  companyId: z.string().trim().min(1).max(128),
  projectId: z.string().trim().min(1).max(128),
  experienceName: z.string().trim().min(2).max(160),
  internalNotes: z.string().trim().max(2_000).nullable().optional(),
  activateEntitlement: z.literal(true),
  structureMode: z.enum(["USE_EXISTING", "CREATE_NOW", "CREATE_LATER"]),
  reason,
});

export const project3DExperienceMetadataSchema = z.object({
  experienceName: z.string().trim().min(2).max(160),
  internalNotes: z.string().trim().max(2_000).nullable().optional(),
  reason,
});

export const project3DExperienceListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  group: z.string().trim().max(128).optional(),
  company: z.string().trim().max(128).optional(),
  state: z.enum(["READY", "PROCESSING", "NEEDS_MODEL", "FAILED"]).optional(),
  publication: z.enum(["PUBLISHED", "DRAFT"]).optional(),
  entitlement: z.enum(["ACTIVE", "SUSPENDED", "INACTIVE", "EXPIRED"]).optional(),
});

export type Project3DExperienceCreate = z.infer<typeof project3DExperienceCreateSchema>;
export type Project3DExperienceMetadata = z.infer<typeof project3DExperienceMetadataSchema>;
export type Project3DExperienceListQuery = z.infer<typeof project3DExperienceListQuerySchema>;

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => value || null);
const nullableDecimal = z.union([z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/), z.literal(""), z.null()]).optional().transform((value) => value || null);
const nullableInteger = z.union([z.number().int().min(0).max(10_000), z.null()]).optional().transform((value) => value ?? null);
const floorNumber = z.number().int().min(-50).max(500).nullable();
const structureReason = { reason };

const unitTechnicalFields = {
  unitTypeId: z.string().trim().min(1).max(128),
  internalArea: nullableDecimal,
  saleableArea: nullableDecimal,
  rooms: nullableInteger,
  bedrooms: nullableInteger,
  bathrooms: nullableInteger,
  description: nullableText(1_000),
};

export const project3DStructureCreateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("building.create"), name: z.string().trim().min(1).max(120), code: nullableText(40), description: nullableText(1_000), ...structureReason }),
  z.object({ action: z.literal("floor.create"), buildingId: z.string().trim().min(1).max(128), number: floorNumber, name: z.string().trim().min(1).max(120), levelType: z.enum(["BASEMENT", "GROUND", "STANDARD", "MEZZANINE", "TECHNICAL", "ROOF", "OTHER"]), elevation: nullableDecimal, description: nullableText(1_000), ...structureReason }),
  z.object({ action: z.literal("floor.bulk"), buildingId: z.string().trim().min(1).max(128), from: z.number().int().min(-50).max(500), to: z.number().int().min(-50).max(500), dryRun: z.boolean().optional().default(false), ...structureReason }).refine((value) => value.to >= value.from && value.to - value.from < 100, { message: "Create a range of at most 100 floors.", path: ["to"] }),
  z.object({ action: z.literal("unit.create"), floorId: z.string().trim().min(1).max(128), unitCode: z.string().trim().min(1).max(80), name: nullableText(160), ...unitTechnicalFields, ...structureReason }),
  z.object({ action: z.literal("unit.bulk"), floorId: z.string().trim().min(1).max(128), prefix: z.string().max(40), start: z.number().int().min(0).max(999_999), end: z.number().int().min(0).max(999_999), padding: z.number().int().min(1).max(8), suffix: z.string().max(20), dryRun: z.boolean().optional().default(false), ...unitTechnicalFields, ...structureReason }).refine((value) => value.end >= value.start && value.end - value.start < 500, { message: "Create a range of at most 500 units.", path: ["end"] }),
]);

export const project3DStructureUpdateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("building"), name: z.string().trim().min(1).max(120), code: nullableText(40), description: nullableText(1_000), isActive: z.boolean(), expectedVersion: z.number().int().positive(), ...structureReason }),
  z.object({ kind: z.literal("floor"), buildingId: z.string().trim().min(1).max(128), number: floorNumber, name: z.string().trim().min(1).max(120), levelType: z.enum(["BASEMENT", "GROUND", "STANDARD", "MEZZANINE", "TECHNICAL", "ROOF", "OTHER"]), elevation: nullableDecimal, description: nullableText(1_000), isActive: z.boolean(), expectedVersion: z.number().int().positive(), ...structureReason }),
  z.object({ kind: z.literal("unit"), floorId: z.string().trim().min(1).max(128), unitCode: z.string().trim().min(1).max(80), name: nullableText(160), ...unitTechnicalFields, isActive: z.boolean(), expectedVersion: z.number().int().positive(), ...structureReason }),
]);

export const project3DStructureDeleteSchema = z.object({ reason });
export type Project3DStructureCreate = z.infer<typeof project3DStructureCreateSchema>;
export type Project3DStructureUpdate = z.infer<typeof project3DStructureUpdateSchema>;

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

export const project3DReleasePublishSchema = z.object({
  versionIds: z.array(z.string().trim().min(1).max(128)).min(1).max(100).refine((ids) => new Set(ids).size === ids.length, "Choose each model version once."),
  reason,
});

export const project3DReleaseActivateSchema = z.object({ reason });

export type Project3DSlotCreate = z.infer<typeof project3DSlotCreateSchema>;
export type Project3DUploadCreate = z.infer<typeof project3DUploadCreateSchema>;
export type Project3DUnitBindingsReplace = z.infer<typeof project3DUnitBindingsReplaceSchema>;
export type Project3DExperienceUpdate = z.infer<typeof project3DExperienceUpdateSchema>;
export type Project3DModelSettingsUpdate = z.infer<typeof project3DModelSettingsUpdateSchema>;
export type Project3DReleasePublish = z.infer<typeof project3DReleasePublishSchema>;
