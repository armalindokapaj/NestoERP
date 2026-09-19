/**
 * Browser-safe contracts shared by the 3D runtime and Platform preview.
 *
 * This module deliberately has no database, storage, auth, or framework imports.
 * Published release manifests use stable NESTO ids and private storage keys;
 * Company bootstrap DTOs replace those keys with short-lived signed URLs.
 */

export const PROJECT_3D_SCHEMA_VERSION = 1 as const;

export const PROJECT_3D_SLOT_ROLES = ["BUILDING", "UNITS", "SURROUNDINGS", "CONTEXT", "CUSTOM"] as const;
export type Project3DSlotRole = (typeof PROJECT_3D_SLOT_ROLES)[number];

export type Vector3Value = { x: number; y: number; z: number };

export type Project3DNodeClassification = "architecture" | "landscape" | "interaction" | "helper";

export type Project3DSceneNode = {
  nodeId: string;
  name: string;
  meshIndex: number | null;
  parentNodeId: string | null;
  depth: number;
  isMesh: boolean;
  autoClassification: "unit_block" | "architecture";
};

export type Project3DNodeOverride = {
  nodeId: string;
  classification?: Project3DNodeClassification;
  materialPreset?: "concrete" | "plaster" | "stone" | "wood" | "aluminium" | "steel" | "chrome" | "ceramic";
  colorHex?: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  iridescence?: number;
  iridescenceIOR?: number;
  visible?: boolean;
  materialOverrideEnabled?: boolean;
  baseTextureEnabled?: boolean;
  roughnessMapEnabled?: boolean;
  metalnessMapEnabled?: boolean;
  normalMapEnabled?: boolean;
  normalStrength?: number;
  aoMapEnabled?: boolean;
  emissiveEnabled?: boolean;
  emissiveMapEnabled?: boolean;
  emissiveColorHex?: string;
  emissiveIntensity?: number;
  transmissionEnabled?: boolean;
  transmission?: number;
  ior?: number;
  thickness?: number;
  attenuationEnabled?: boolean;
  attenuationColorHex?: string;
  attenuationDistance?: number;
  anisotropy?: number;
  anisotropyRotation?: number;
  sheen?: number;
  sheenColorHex?: string;
  sheenRoughness?: number;
  dispersion?: number;
  textureTransformEnabled?: boolean;
  mapScaleX?: number;
  mapScaleY?: number;
  mapOffsetX?: number;
  mapOffsetY?: number;
  mapRotation?: number;
};

export type Project3DUnitBinding = {
  meshName: string;
  unitId: string;
  unitCode: string;
  poiYawDeg: number;
  poiEnabled: boolean;
  poiDistanceOverride: number | null;
  poiHeightOverride: number | null;
};

export type Project3DModelTransform = {
  scale: number;
  rotationDeg: number;
  altitudeOffset: number;
  positionX: number;
  positionZ: number;
  rotationXDeg: number;
  rotationZDeg: number;
};

export type Project3DReleaseModel = {
  slotId: string;
  slotName: string;
  slotRole: Project3DSlotRole;
  versionId: string;
  versionNumber: number;
  runtimeStorageKey: string;
  runtimeFileName: string;
  runtimeContentType: "model/gltf-binary";
  transform: Project3DModelTransform;
  visible: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  selectable: boolean;
  sceneManifest: Project3DSceneNode[];
  nodeOverrides: Project3DNodeOverride[];
  unitBindings: Project3DUnitBinding[];
};

export type Project3DReleaseManifest = {
  schemaVersion: typeof PROJECT_3D_SCHEMA_VERSION;
  projectId: string;
  companyId: string;
  releaseId: string;
  releaseNumber: number;
  createdAt: string;
  experience: Record<string, unknown>;
  models: Project3DReleaseModel[];
};

