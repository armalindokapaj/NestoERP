import { z } from "zod";

import { PROJECT_3D_SLOT_ROLES } from "@/lib/3d/shared/contracts";
import {
  project3DModelTransformSchema,
  project3DNodeOverrideSchema,
  project3DSceneNodeSchema,
} from "@/lib/3d/shared/release.schema";

/**
 * The Public3DManifest (ADM-04A §7): what an anonymous visitor may receive of
 * one approved release. A deliberate projection with its own schema — never
 * the internal manifest with keys removed. Every identifier in it is local to
 * this release (m1, u1, n12…); the mapping back to canonical records stays on
 * the server. Browser-safe: no server imports.
 */

export const PUBLIC_3D_SCHEMA_VERSION = 1 as const;

/** Content an administrator may add to the public projection. Everything else is excluded. */
export const PUBLIC_3D_OPTIONAL_FIELDS = ["description", "cover", "city", "unitCode", "unitFloor", "unitType", "unitArea", "availability"] as const;
export type Public3DOptionalField = (typeof PUBLIC_3D_OPTIONAL_FIELDS)[number];

export const PUBLIC_3D_FIELD_LABELS: Record<Public3DOptionalField, string> = {
  description: "Public description",
  cover: "Cover image",
  city: "City",
  unitCode: "Unit codes",
  unitFloor: "Unit floor",
  unitType: "Unit type",
  unitArea: "Unit area",
  availability: "Unit availability (available / reserved / sold)",
};

const opaqueId = z.string().regex(/^[a-z]{1,2}\d{1,6}$/);

export const public3DUnitSchema = z.object({
  ref: opaqueId,
  label: z.string().min(1).max(80),
  code: z.string().max(40).nullable(),
  floor: z.number().int().nullable(),
  type: z.enum(["residential", "commercial", "parking", "storage"]).nullable(),
  area: z.number().nonnegative().nullable(),
  status: z.enum(["available", "reserved", "sold"]).nullable(),
});

export const public3DModelSchema = z.object({
  assetId: opaqueId,
  role: z.enum(PROJECT_3D_SLOT_ROLES),
  parentAssetId: opaqueId.nullable(),
  transform: project3DModelTransformSchema,
  visible: z.boolean(),
  castShadow: z.boolean(),
  receiveShadow: z.boolean(),
  selectable: z.boolean(),
  sceneManifest: z.array(project3DSceneNodeSchema),
  nodeOverrides: z.array(project3DNodeOverrideSchema),
  unitBindings: z.array(z.object({
    meshName: z.string().min(1).max(40),
    unitRef: opaqueId,
    poiYawDeg: z.number(),
    poiEnabled: z.boolean(),
    poiDistanceOverride: z.number().nullable(),
    poiHeightOverride: z.number().nullable(),
  })),
});

export const public3DManifestSchema = z.object({
  schemaVersion: z.literal(PUBLIC_3D_SCHEMA_VERSION),
  releaseNumber: z.number().int().positive(),
  title: z.string().min(1).max(160),
  description: z.string().max(2000).nullable(),
  city: z.string().max(120).nullable(),
  cover: z.object({ assetId: opaqueId, contentType: z.enum(["image/jpeg", "image/png", "image/webp"]) }).nullable(),
  experience: z.record(z.string(), z.unknown()),
  models: z.array(public3DModelSchema).min(1),
  units: z.array(public3DUnitSchema),
  fields: z.array(z.enum(PUBLIC_3D_OPTIONAL_FIELDS)),
}).strict();

export type Public3DManifest = z.infer<typeof public3DManifestSchema>;

/** What the anonymous viewer is sent: the manifest's content plus gated asset URLs. */
export const public3DBootstrapSchema = z.object({
  schemaVersion: z.literal(PUBLIC_3D_SCHEMA_VERSION),
  releaseNumber: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullable(),
  city: z.string().nullable(),
  coverUrl: z.string().nullable(),
  experience: z.record(z.string(), z.unknown()),
  models: z.array(public3DModelSchema.extend({ assetUrl: z.string().min(1) })),
  units: z.array(public3DUnitSchema),
  fields: z.array(z.enum(PUBLIC_3D_OPTIONAL_FIELDS)),
  token: z.string(),
  preview: z.boolean(),
}).strict();

export type Public3DBootstrap = z.infer<typeof public3DBootstrapSchema>;

export const public3DStatusSchema = z.object({
  state: z.enum(["AVAILABLE", "LOGIN_REQUIRED", "UNAVAILABLE"]),
  token: z.string().nullable(),
});

export type Public3DStatus = z.infer<typeof public3DStatusSchema>;
