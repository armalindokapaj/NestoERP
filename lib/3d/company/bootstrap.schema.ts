import { z } from "zod";

import { PROJECT_3D_SCHEMA_VERSION, PROJECT_3D_SLOT_ROLES } from "@/lib/3d/shared/contracts";
import {
  project3DModelTransformSchema,
  project3DNodeOverrideSchema,
  project3DSceneNodeSchema,
  project3DUnitBindingSchema,
} from "@/lib/3d/shared/release.schema";

const signedAssetSchema = z.object({
  url: z.string().min(1),
  expiresAt: z.string().datetime(),
  fileName: z.string().min(1),
  contentType: z.literal("model/gltf-binary"),
});

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
      transformParentSlotId: z.string().min(1).nullable(),
      versionId: z.string().min(1),
      versionNumber: z.number().int().positive(),
      asset: signedAssetSchema,
      transform: project3DModelTransformSchema,
      visible: z.boolean(),
      castShadow: z.boolean(),
      receiveShadow: z.boolean(),
      selectable: z.boolean(),
      sceneManifest: z.array(project3DSceneNodeSchema),
      nodeOverrides: z.array(project3DNodeOverrideSchema),
      unitBindings: z.array(project3DUnitBindingSchema),
    })
  ),
  units: z.array(z.object({
    id: z.string().min(1),
    code: z.string().min(1),
    name: z.string().nullable(),
    status: z.enum(["available", "reserved", "sold"]),
    building: z.object({ id: z.string().min(1), name: z.string().min(1), code: z.string().nullable() }).nullable(),
    floor: z.object({ id: z.string().min(1), name: z.string().min(1), number: z.number().int().nullable() }).nullable(),
    type: z.object({ id: z.string().min(1), name: z.string().min(1), category: z.string().min(1) }).nullable(),
    internalArea: z.string().nullable(),
    saleableArea: z.string().nullable(),
    rooms: z.number().int().nullable(),
    bedrooms: z.number().int().nullable(),
    bathrooms: z.number().int().nullable(),
    commercial: z.object({ askingPrice: z.string().nullable(), currency: z.string().nullable(), pricePerSqm: z.string().nullable() }).nullable(),
    salesPlan: z.object({ documentId: z.string().min(1), name: z.string().min(1), href: z.string().min(1) }).nullable(),
    media: z.array(z.object({ id: z.string().min(1), category: z.string().min(1), caption: z.string().nullable(), isPrimary: z.boolean(), thumbnailHref: z.string().min(1) })),
  })),
  capabilities: z.object({ mapbox: z.boolean(), unitDetails: z.boolean(), commercial: z.boolean(), files: z.boolean() }),
});

export type Project3DBootstrap = z.infer<typeof project3DBootstrapSchema>;
export type Project3DBootstrapModel = Project3DBootstrap["models"][number];
export type Project3DCompanyUnitBinding = z.infer<typeof project3DUnitBindingSchema>;

// Used by the runtime handle without importing Three.js into server code.
export type Project3DCameraState = {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov: number;
};
