import { z } from "zod";

import { PROJECT_3D_SCHEMA_VERSION, PROJECT_3D_SLOT_ROLES } from "@/lib/3d/shared/contracts";

const signedAssetSchema = z.object({
  url: z.string().min(1),
  expiresAt: z.string().datetime(),
  fileName: z.string().min(1),
  contentType: z.literal("model/gltf-binary"),
});

const sceneNodeSchema = z.object({
  nodeId: z.string().min(1),
  name: z.string(),
  meshIndex: z.number().int().nonnegative().nullable(),
  parentNodeId: z.string().nullable(),
  depth: z.number().int().nonnegative(),
  isMesh: z.boolean(),
  autoClassification: z.enum(["unit_block", "architecture"]),
});

const unitBindingSchema = z.object({
  meshName: z.string().min(1),
  unitId: z.string().min(1),
  unitCode: z.string().min(1),
  poiYawDeg: z.number(),
  poiEnabled: z.boolean(),
  poiDistanceOverride: z.number().nullable(),
  poiHeightOverride: z.number().nullable(),
});

const nodeOverrideSchema = z
  .object({
    nodeId: z.string().min(1),
    classification: z.enum(["architecture", "landscape", "interaction", "helper"]).optional(),
    materialPreset: z.enum(["concrete", "plaster", "stone", "wood", "aluminium", "steel", "chrome", "ceramic"]).optional(),
    colorHex: z.string().optional(),
    roughness: z.number().optional(),
    metalness: z.number().optional(),
    opacity: z.number().optional(),
    visible: z.boolean().optional(),
  })
  .passthrough();

export const project3DBootstrapSchema = z.object({
  schemaVersion: z.literal(PROJECT_3D_SCHEMA_VERSION),
  project: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  release: z.object({ id: z.string().min(1), number: z.number().int().positive(), publishedAt: z.string().datetime() }),
  experience: z.record(z.string(), z.unknown()),
  models: z.array(
    z.object({
      slotId: z.string().min(1),
      slotName: z.string().min(1),
      slotRole: z.enum(PROJECT_3D_SLOT_ROLES),
      versionId: z.string().min(1),
      versionNumber: z.number().int().positive(),
      asset: signedAssetSchema,
      transform: z.object({
        scale: z.number().positive(),
        rotationDeg: z.number(),
        altitudeOffset: z.number(),
        positionX: z.number(),
        positionZ: z.number(),
        rotationXDeg: z.number(),
        rotationZDeg: z.number(),
      }),
      visible: z.boolean(),
      castShadow: z.boolean(),
      receiveShadow: z.boolean(),
      selectable: z.boolean(),
      sceneManifest: z.array(sceneNodeSchema),
      nodeOverrides: z.array(nodeOverrideSchema),
      unitBindings: z.array(unitBindingSchema),
    })
  ),
  capabilities: z.object({ mapbox: z.boolean() }),
});

export type Project3DBootstrap = z.infer<typeof project3DBootstrapSchema>;
export type Project3DBootstrapModel = Project3DBootstrap["models"][number];
export type Project3DCompanyUnitBinding = z.infer<typeof unitBindingSchema>;

// Used by the runtime handle without importing Three.js into server code.
export type Project3DCameraState = {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov: number;
};
