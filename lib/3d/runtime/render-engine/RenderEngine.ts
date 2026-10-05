import * as THREE from "three/webgpu";
import mapboxgl from "mapbox-gl";
import { StudioBasemapLayer } from "./StudioBasemapLayer";
import type { BasemapAnchor } from "./basemapCameraSync";
import { buildSiteTerrain, type SiteTerrainResult } from "./siteTerrain";
import { isSlotCutBySections } from "./sectionScope";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SkyMesh } from "three/examples/jsm/objects/SkyMesh.js";
import { WaterMesh } from "three/examples/jsm/objects/WaterMesh.js";
import { length as tslLength, mix as tslMix, positionWorld, smoothstep as tslSmoothstep, uniform } from "three/tsl";
import { buildCloudSystem, cloudShadowFactor, type CloudSystem } from "./clouds";
import { buildFogSystem, type FogSystem } from "./fog";
import { geographicSunPosition, sunColorForElevation, sunDirectionVector, sunPositionForAnchors } from "@/lib/3d/runtime/sunPosition";
import { applyTransmittedShadows, buildCSMSystem, setShadowMapTransmitted, type CSMSystem } from "./shadows";
import { buildScenePostPipeline, computeScenePostSignature, type ScenePostPipeline } from "./postProcessing";
import { ensureLutLoading } from "./lut";
import { ArtificialLightSystem } from "./artificialLights";
import { DRACO_DECODER_PATH } from "@/lib/3d/runtime/gltfDecoder";
import { cleanGlbNodeName } from "@/lib/3d/shared/glbNodeName";
import {
  FOG_SKY_HORIZON_COLOR,
  GROUND_INFINITE_SIZE,
  QUALITY_TIERS,
  SKY_DOME_SCALE,
  WATER_PLANE_SIZE,
} from "@/lib/3d/runtime/viewerPresets";
import { buildSectionCapGeometry, buildSectionPlanes, NO_ACTIVE_SECTION_PLANES, SECTION_INDICATOR_COLOR } from "./sections";
import {
  applyUnitBoxAppearance,
  applyUnitSelectionScale,
  buildUnitRegistry,
  clearUnitSelectionScale,
  clipUnitOutlinesState,
  clipUnitOutlinesToSection,
  disposeUnitBoxAppearanceCaches,
  findUnitRootObjects,
  type UnitRuntimeEntry,
  type UnitSelectionScaleOriginals,
} from "./unitRegistry";
import type { LineSegments2 } from "three/examples/jsm/lines/webgpu/LineSegments2.js";
import { IdleDroneController } from "./idleDroneCamera";
import { PROJECT_3D_ASSETS } from "@/lib/3d/runtime/assets";
import type {
  CameraPreset,
  DetailModelSlotRole,
  EnvironmentConfig,
  SiteRuntimeConfig,
  LightingConfig,
  NodeOverride,
  Project3DConfig,
  ProjectDetailModel,
  RenderingConfig,
  Section,
  SceneManifestNode,
  Unit,
  UnitMeshLink,
  UnitsConfig,
} from "@/lib/3d/runtime/types";

export const DEFAULT_ENVIRONMENT_CONFIG: EnvironmentConfig = {
  solarControllerEnabled: false,
  solarPathMode: "manual",
  viewerTimeHours: 12,
  solarAnchors: [],
  geoLatitude: 41.3275,
  geoLongitude: 19.8187,
  simulationDate: "2025-01-01T00:00:00.000Z",
  northOffsetDeg: 0,
  siteRotationDeg: 0,
  sunDiscEnabled: true,
  autoSunIntensityEnabled: true,
  autoSunColorEnabled: true,
  manualSunIntensity: 1.2,
  manualSunColorHex: "#ffffff",
  environmentRefreshEnabled: true,
  sunAzimuthDeg: 180,
  sunElevationDeg: 45,
  skyEnabled: true,
  skyTurbidity: 4,
  skyRayleigh: 2.4,
  skyMieCoefficient: 0.004,
  skyMieDirectionalG: 0.78,
  backdropEnabled: false,
  backdropImageUrl: null,
  backdropRotationDeg: 0,
  backdropPitchDeg: 0,
  backdropElevation: 0,
  environmentIntensity: 1,
  cloudsEnabled: false,
  cloudCoverage: 0.4,
  cloudDensity: 0.5,
  cloudElevation: 0.5,
  cloudMovementEnabled: true,
  cloudSunLightingEnabled: true,
  cloudShadowsEnabled: false,
  cloudHeight: 220,
  cloudThickness: 50,
  cloudThreshold: 0.45,
  cloudOpacity: 0.85,
  cloudSoftness: 0.35,
  cloudScale: 0.01,
  cloudWindSpeed: 0.02,
  cloudWindDirectionDeg: 45,
  cloudRaymarchSteps: 16,
  fogEnabled: false,
  fogColor: "#c9d6e0",
  fogDensity: 0.015,
  fogMatchesSky: false,
  fogHeightBandEnabled: false,
  fogHazeEnabled: false,
  fogNoiseEnabled: false,
  fogMovementEnabled: true,
  fogSunInteractionEnabled: true,
  fogBaseHeight: 0,
  fogTopHeight: 40,
  fogHaze: 0.3,
  fogNoiseStrength: 0.3,
  fogNoiseScale: 0.05,
  fogWindDirectionDeg: 0,
  fogWindSpeed: 0.02,
  fogFalloff: 1,
  fogMaxOpacity: 0.85,
  waterEnabled: false,
  waterDistortionScale: 3.7,
  waterSize: 1,
  waterType: "decorative",
  waterWavesEnabled: true,
  waterMovementEnabled: true,
  waterSunReflectionEnabled: true,
  waterEnvReflectionEnabled: true,
  waterNormalMapEnabled: true,
  waterHeight: 0,
  waterColor: "#001e0f",
  waterDeepColor: "#00131f",
  groundEnabled: true,
  groundStyle: "disc",
  groundColor: "#d8d6e6",
  groundFogEnabled: false,
  groundFogRadius: 300,
};

function resolveFogColor(config: EnvironmentConfig): string {
  return config.fogMatchesSky ? FOG_SKY_HORIZON_COLOR : config.fogColor;
}

const WORLD_ORIGIN = new THREE.Vector3(0, 0, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

const TONE_MAPPING_MAP: Record<RenderingConfig["toneMapping"], THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
};

export const DEFAULT_LIGHTING_CONFIG: LightingConfig = {
  sunLightEnabled: true,
  sunTemperatureK: 5500,
  autoSunIntensityEnabled: true,
  autoSunColorEnabled: true,
  manualSunIntensity: 1.2,
  manualSunColorHex: "#ffffff",
  csmEnabled: false,
  csmCascades: 3,
  csmMaxDistance: 200,
  csmResolution: 2048,
  csmSplitMode: "practical",
  csmMargin: 100,
  softShadowsEnabled: true,
  shadowSoftness: 0,
  shadowsEnabled: true,
  contactShadowsEnabled: false,
  contactShadowBlur: 0.5,
  contactShadowDarkness: 0.6,
  contactShadowOpacity: 0.8,
  contactShadowRange: 0.3,
  transmittedShadowsEnabled: false,
  coloredShadowsEnabled: false,
  transmittedShadowStrength: 0.6,
  giEnabled: false,
  giIndirectEnabled: true,
  giAOEnabled: true,
  giBackfaceLighting: false,
  giTemporalFiltering: true,
  giScreenSpaceSampling: true,
  giIntensity: 10,
  giAOIntensity: 1,
  giRadius: 12,
  giSliceCount: 1,
  giStepCount: 12,
  giExpFactor: 2,
  giThickness: 1,
  giLinearThickness: false,
  artificialLights: [],
  volumetricLightingEnabled: false,
  sunShaftsEnabled: true,
  lightVolumesEnabled: false,
  volumetricRaymarchSteps: 60,
  volumetricDensity: 0.7,
  volumetricMaxDensity: 0.5,
  volumetricDistanceAtten: 2,
};

export const DEFAULT_RENDERING_CONFIG: RenderingConfig = {
  ssrEnabled: false,
  ssrIntensity: 1,
  ssrMaxDistance: 30,
  ssrThickness: 0.5,
  ssrQuality: 0.5,
  antialiasEnabled: true,
  bloomEnabled: false,
  bloomStrength: 1,
  bloomRadius: 0,
  lensFlareEnabled: false,
  lensFlareIntensity: 1,
  depthOfFieldEnabled: false,
  depthOfFieldFocalLength: 10,
  depthOfFieldBokehScale: 1,
  distanceBlurEnabled: false,
  distanceBlurStartM: 150,
  distanceBlurFullM: 400,
  distanceBlurAmount: 0.9,
  distanceBlurRadius: 2,
  cameraAutoFocusEnabled: true,
  motionBlurEnabled: false,
  motionBlurIntensity: 1,
  exposure: 1,
  toneMapping: "aces",
  lutEnabled: false,
  lutPreset: "bourbon64",
  lutIntensity: 1,
};

export const DEFAULT_UNITS_CONFIG: UnitsConfig = {
  unitColorAvailable: "#22c55e",
  unitColorReserved: "#eab308",
  unitColorSold: "#ef4444",
  unitColorSelected: "#6b55f5",
  unitBlocksEnabled: true,
  unitBlocksStatusColorsEnabled: true,
  unitBlocksXrayEnabled: true,
  unitBlocksDefaultOpacity: 0.18,
  unitBlocksHoverOpacity: 0.25,
  unitBlocksSelectedOpacity: 0.32,
  unitBlocksSelectedOutlineEnabled: true,
  unitBlocksSelectedOutlineWidth: 2.5,
  unitBlocksSelectedScaleEnabled: false,
  unitBlocksSelectedScale: 1.05,
  unitBlocksSelectedFillEnabled: true,
  unitColorSelectedFill: "#6b55f5",
  unitBlocksSelectedXrayEnabled: false,
  unitPoiCameraEnabled: true,
  unitPoiCameraFov: 38,
  unitPoiCameraDistanceMultiplier: 3,
  unitPoiCameraHeightOffset: 0.5,
  unitPoiTransitionMs: 900,
  unitPoiAutoOcclusionCorrection: false,
};

export type QualityConfig = Pick<
  Project3DConfig,
  "renderingMode" | "qualityPreset" | "customRenderScale" | "customDprCap" | "adaptiveQualityEnabled" | "runtimeQualityReductionEnabled" | "interactionQualityReductionEnabled"
>;

const DEFAULT_QUALITY_CONFIG: QualityConfig = {
  renderingMode: "auto",
  qualityPreset: "high_desktop",
  customRenderScale: null,
  customDprCap: null,
  adaptiveQualityEnabled: true,
  runtimeQualityReductionEnabled: true,
  interactionQualityReductionEnabled: true,
};

function resolveQualityTarget(config: QualityConfig): { renderScale: number; dprCap: number; shadowMapSize: number } {
  const tier = QUALITY_TIERS[config.qualityPreset];
  if (config.qualityPreset === "custom") {
    return {
      renderScale: config.customRenderScale ?? tier.renderScale,
      dprCap: config.customDprCap ?? tier.dprCap,
      shadowMapSize: tier.shadowMapSize,
    };
  }
  return { renderScale: tier.renderScale, dprCap: tier.dprCap, shadowMapSize: tier.shadowMapSize };
}

function applySunShadowMapSize(sun: THREE.DirectionalLight, size: number) {
  if (sun.shadow.mapSize.x === size && sun.shadow.mapSize.y === size) return;
  sun.shadow.mapSize.set(size, size);
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
}

const UNIT_NODE_PATTERN = /^Unit_/i;

export type CameraConfig = Pick<
  Project3DConfig,
  | "cameraFovDesktop"
  | "cameraFovMobile"
  | "cameraNearClip"
  | "cameraFarClip"
  | "cameraStartDistanceMultiplier"
  | "cameraMinDistanceMultiplier"
  | "cameraMaxDistanceMultiplier"
  | "cameraMinPolarDeg"
  | "cameraMaxPolarDeg"
  | "cameraMinAzimuthDeg"
  | "cameraMaxAzimuthDeg"
  | "cameraOrbitEnabled"
  | "cameraPanEnabled"
  | "cameraZoomEnabled"
  | "cameraDampingEnabled"
  | "autoRotate"
  | "idleDroneEnabled"
  | "idleDroneDelaySec"
  | "idleDroneOrbitDurationSec"
  | "idleDroneClockwise"
  | "idleDroneMotionEnabled"
  | "idleDroneHeightEnabled"
  | "idleDroneHeightAmplitude"
  | "idleDroneDistanceEnabled"
  | "idleDroneDistanceAmplitude"
  | "idleDroneTargetEnabled"
  | "idleDroneTargetAmplitude"
  | "idleDroneVerticalCycles"
  | "idleDronePhaseOffsetDeg"
  | "idleDroneSmoothness"
  | "cameraPresets"
>;

const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  cameraFovDesktop: 50,
  cameraFovMobile: 60,
  cameraNearClip: 0.1,
  cameraFarClip: 2000,
  cameraStartDistanceMultiplier: 1.5,
  cameraMinDistanceMultiplier: 0.4,
  cameraMaxDistanceMultiplier: 2.5,
  cameraMinPolarDeg: 0,
  cameraMaxPolarDeg: 85,
  cameraMinAzimuthDeg: null,
  cameraMaxAzimuthDeg: null,
  cameraOrbitEnabled: true,
  cameraPanEnabled: true,
  cameraZoomEnabled: true,
  cameraDampingEnabled: true,
  autoRotate: false,
  idleDroneEnabled: true,
  idleDroneDelaySec: 60,
  idleDroneOrbitDurationSec: 80,
  idleDroneClockwise: true,
  idleDroneMotionEnabled: true,
  idleDroneHeightEnabled: true,
  idleDroneHeightAmplitude: 0.18,
  idleDroneDistanceEnabled: true,
  idleDroneDistanceAmplitude: 0.05,
  idleDroneTargetEnabled: true,
  idleDroneTargetAmplitude: 0.06,
  idleDroneVerticalCycles: 2,
  idleDronePhaseOffsetDeg: 0,
  idleDroneSmoothness: 0.88,
  cameraPresets: [],
};

const MOBILE_VIEWPORT_BREAKPOINT = 768;
// Phone GPUs and iOS's per-tab memory budget draw an oversized texture as black, so
// textures above this edge are redrawn smaller before they reach the GPU.
const MOBILE_MAX_TEXTURE_PX = 2048;

function capTextureSizes(root: THREE.Object3D, maxPx: number) {
  const done = new Set<THREE.Texture>();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) {
        const texture = value as THREE.Texture | null;
        if (!texture || !(texture as THREE.Texture).isTexture || done.has(texture)) continue;
        done.add(texture);
        const image = texture.image as (CanvasImageSource & { width: number; height: number }) | null | undefined;
        if (!image || !image.width || !image.height || Math.max(image.width, image.height) <= maxPx) continue;
        const scale = maxPx / Math.max(image.width, image.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) continue;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        texture.image = canvas;
        texture.needsUpdate = true;
      }
    }
  });
}

// Mobile browsers' WebGPU is the least settled backend this renderer meets (the whole
// model draws black there), so "auto" takes the WebGL2 backend on phones and tablets.
function isTouchPhoneOrTablet(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent ?? "") || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent ?? ""));
}

const RESIZE_THROTTLE_MS = 90;

const PERF_SAMPLE_EVERY_N_FRAMES = 20;

const MAX_REPORTED_GPU_ERRORS = 6;

export interface RendererFacts {
  backend: "webgpu" | "webgl2";
  webgpuAvailable: boolean;
  glRenderer: string | null;
  maxTextureSize: number | null;
  drawingBufferPx: { width: number; height: number } | null;
  pixelRatio: number;
  contextLostCount: number;
  gpuErrors: string[];
}

export type ModelLoadStatus =
  | { state: "loading" }
  | { state: "ready" }
  | { state: "failed"; models: string[]; forbidden: boolean };

export interface RenderEngineCallbacks {
  onModelLoadStatus?: (status: ModelLoadStatus) => void;
  onWebglFail: () => void;
  onContextLost?: () => void;
  onRendererFacts?: (facts: RendererFacts) => void;
  onSiteStatus?: (
    status:
      | { state: "loading" }
      | { state: "failed"; reason?: string }
      | { state: "ready"; centreElevationM: number; reliefM: { min: number; max: number } }
  ) => void;
  onPerfStats: (
    stats: {
      fps: number;
      frameTimeMs: number;
      drawCalls: number;
      triangles: number;
      textures: number;
      dpr: number;
      outlineClip: string;
    } | null
  ) => void;
  onUnitClick?: (unitId: string | null) => void;
  onUnitHover?: (unitId: string | null) => void;
}

export interface DetailModelEntry {
  slotId: string;
  model: ProjectDetailModel;
  units?: Unit[];
  statusPreviewEnabled?: boolean;
  slotRole?: DetailModelSlotRole;
  transformParentSlotId?: string | null;
  slotName?: string;
}

export interface MountParams {
  showPerfStats?: boolean;
  qualityConfig?: QualityConfig;
  basemapAnchor?: BasemapAnchor | null;
}

function normalizeMaterials(m: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(m) ? m : [m];
}

function buildOverriddenMaterial(original: THREE.Material, override: NodeOverride): THREE.Material {
  const std = original as THREE.MeshStandardMaterial;
  const needsPhysical =
    override.clearcoat != null ||
    override.clearcoatRoughness != null ||
    override.iridescence != null ||
    override.iridescenceIOR != null ||
    override.transmissionEnabled ||
    override.anisotropy != null ||
    override.sheen != null ||
    override.dispersion != null;

  let mat: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
  if (needsPhysical) {
    mat =
      original instanceof THREE.MeshPhysicalMaterial
        ? (original.clone() as THREE.MeshPhysicalMaterial)
        : new THREE.MeshPhysicalMaterial({
            color: std.color?.clone(),
            map: std.map ?? null,
            normalMap: std.normalMap ?? null,
            roughnessMap: std.roughnessMap ?? null,
            metalnessMap: std.metalnessMap ?? null,
            aoMap: std.aoMap ?? null,
            emissiveMap: std.emissiveMap ?? null,
            emissive: std.emissive?.clone(),
            emissiveIntensity: std.emissiveIntensity,
            roughness: std.roughness,
            metalness: std.metalness,
            opacity: std.opacity,
            transparent: std.transparent,
            envMapIntensity: std.envMapIntensity,
          });
  } else {
    mat = std.clone();
  }

  if (override.colorHex) mat.color?.set(override.colorHex);
  if (override.baseTextureEnabled === false) mat.map = null;
  if (override.roughness != null) mat.roughness = override.roughness;
  if (override.roughnessMapEnabled === false) mat.roughnessMap = null;
  if (override.metalness != null) mat.metalness = override.metalness;
  if (override.metalnessMapEnabled === false) mat.metalnessMap = null;
  if (override.opacity != null) {
    mat.opacity = override.opacity;
    mat.transparent = override.opacity < 1;
  }
  if (override.normalMapEnabled === false) mat.normalMap = null;
  if (override.normalStrength != null && mat.normalMap) {
    mat.normalScale = new THREE.Vector2(override.normalStrength, override.normalStrength);
  }
  if (override.aoMapEnabled === false) mat.aoMap = null;

  if (override.emissiveEnabled) {
    if (override.emissiveColorHex) mat.emissive?.set(override.emissiveColorHex);
    if (override.emissiveIntensity != null) mat.emissiveIntensity = override.emissiveIntensity;
  } else if (override.emissiveEnabled === false) {
    mat.emissive?.set(0x000000);
    mat.emissiveIntensity = 0;
  }
  if (override.emissiveMapEnabled === false) mat.emissiveMap = null;

  if (mat instanceof THREE.MeshPhysicalMaterial) {
    if (override.clearcoat != null) mat.clearcoat = override.clearcoat;
    if (override.clearcoatRoughness != null) mat.clearcoatRoughness = override.clearcoatRoughness;
    if (override.iridescence != null) mat.iridescence = override.iridescence;
    if (override.iridescenceIOR != null) mat.iridescenceIOR = override.iridescenceIOR;
    if (override.anisotropy != null) mat.anisotropy = override.anisotropy;
    if (override.anisotropyRotation != null) mat.anisotropyRotation = override.anisotropyRotation;
    if (override.sheen != null) mat.sheen = override.sheen;
    if (override.sheenColorHex) mat.sheenColor?.set(override.sheenColorHex);
    if (override.sheenRoughness != null) mat.sheenRoughness = override.sheenRoughness;
    if (override.dispersion != null) mat.dispersion = override.dispersion;
    if (override.transmissionEnabled) {
      mat.transmission = override.transmission ?? 1;
      if (override.ior != null) mat.ior = override.ior;
      if (override.thickness != null) mat.thickness = override.thickness;
      if (override.attenuationEnabled) {
        if (override.attenuationColorHex) mat.attenuationColor?.set(override.attenuationColorHex);
        if (override.attenuationDistance != null) mat.attenuationDistance = override.attenuationDistance;
      }
    }
  }

  if (override.textureTransformEnabled) {
    const maps = [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.aoMap, mat.emissiveMap].filter(
      (t): t is THREE.Texture => !!t
    );
    maps.forEach((tex) => {
      if (override.mapScaleX != null || override.mapScaleY != null) {
        tex.repeat.set(override.mapScaleX ?? tex.repeat.x, override.mapScaleY ?? tex.repeat.y);
      }
      if (override.mapOffsetX != null || override.mapOffsetY != null) {
        tex.offset.set(override.mapOffsetX ?? tex.offset.x, override.mapOffsetY ?? tex.offset.y);
      }
      if (override.mapRotation != null) tex.rotation = (override.mapRotation * Math.PI) / 180;
      tex.needsUpdate = true;
    });
  }

  return mat;
}

export class RenderEngine {
  private callbacks: RenderEngineCallbacks;
  private mountToken = 0;

  private container: HTMLDivElement | null = null;
  private renderer: THREE.WebGPURenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private map: mapboxgl.Map | null = null;
  private basemapLayer: StudioBasemapLayer | null = null;
  private basemapRafId: number | null = null;
  private ambient: THREE.AmbientLight | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastResizeAt = 0;

  private clippingGroup: THREE.ClippingGroup | null = null;
  private unclippedModelGroup: THREE.Group | null = null;
  private sectionHelperGroup: THREE.Group | null = null;
  private activeSectionId: string | null = null;
  private activeSectionPlanes: THREE.Plane[] | null = null;
  private sectionFillClippingGroup: THREE.ClippingGroup | null = null;
  private sectionFillMaterial: THREE.MeshBasicMaterial | null = null;
  private sectionIndicatorMaterial: THREE.MeshBasicMaterial | null = null;
  private sectionIndicatorMesh: THREE.Mesh | null = null;
  private sectionFillMeshes: THREE.Mesh[] = [];
  private dracoLoader: DRACOLoader | null = null;
  private loader: GLTFLoader | null = null;
  private loadedRoots: THREE.Object3D[] = [];
  private modelRootsBySlot = new Map<string, THREE.Object3D>();
  private lastSyncEntries: DetailModelEntry[] = [];
  private loadedGlbUrlBySlot = new Map<string, string>();
  private originalMaterials = new WeakMap<THREE.Mesh, THREE.Material[]>();
  private selectedUnitId: string | null = null;
  private syncToken = 0;

  private unitsConfig: UnitsConfig = DEFAULT_UNITS_CONFIG;
  private unitMaterialCache = new Map<string, THREE.MeshBasicMaterial>();
  private unitOutlineByMesh = new Map<THREE.Mesh, LineSegments2>();
  private unitSelectionScaleOriginals: UnitSelectionScaleOriginals = new Map();
  private unitRegistry = new Map<string, UnitRuntimeEntry>();
  private unitRaycastTargets: THREE.Mesh[] = [];
  private hoveredUnitId: string | null = null;
  private isolatedUnitId: string | null = null;
  private unitStatusFilters: { available: boolean; reserved: boolean; sold: boolean } = {
    available: true,
    reserved: true,
    sold: true,
  };
  private unitIdFilter: Set<string> | null = null;
  private unitsModeEnabled = false;

  private showPerfStats = false;
  private perfSampleCounter = 0;
  private frameTimes: number[] = [];
  private lastFrameAt: number | null = null;

  private qualityConfig: QualityConfig = DEFAULT_QUALITY_CONFIG;
  private effectiveRenderScale = 1;
  private downgradeStep = 0;
  private isInteracting = false;
  private interactionRenderScale: number | null = null;
  private isMobileViewport = false;
  private contextLostCount = 0;
  private readonly gpuErrors: string[] = [];
  private lastDrawCallMark: number | null = null;

  private cameraConfig: CameraConfig = DEFAULT_CAMERA_CONFIG;
  private boundingRadius = 20;

  private idleDrone = new IdleDroneController();
  private prefersReducedMotion = false;
  private visibilityHandler: (() => void) | null = null;
  private dronePathHelperGroup: THREE.Group | null = null;
  private showDronePath = false;
  private droneRingLines: THREE.Line[] = [];
  private droneMarker: THREE.Mesh | null = null;

  private environmentConfig: EnvironmentConfig = DEFAULT_ENVIRONMENT_CONFIG;
  private envScene: THREE.Scene | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRenderTarget: THREE.RenderTarget | null = null;
  private skyMesh: InstanceType<typeof SkyMesh> | null = null;
  private backdropMesh: THREE.Mesh | null = null;
  private backdropImageUrl: string | null = null;
  private waterMesh: InstanceType<typeof WaterMesh> | null = null;
  private groundMesh: THREE.Mesh | null = null;
  private groundColorUniform: { value: THREE.Color } | null = null;
  private groundFogColorUniform: { value: THREE.Color } | null = null;
  private groundFogRadiusUniform: { value: number } | null = null;
  private groundFogStrengthUniform: { value: number } | null = null;
  private groundCloudShadowStrengthUniform: { value: number } | null = null;
  private groundCloudHeightUniform: { value: number } | null = null;
  private groundCloudScaleUniform: { value: number } | null = null;
  private groundCloudCoverageUniform: { value: number } | null = null;
  private groundCloudWindUniform: { value: THREE.Vector2 } | null = null;
  private groundSunDirectionUniform: { value: THREE.Vector3 } | null = null;
  private cloudSystem: CloudSystem | null = null;
  private fogSystem: FogSystem | null = null;
  private siteGroup: THREE.Group | null = null;
  private siteResult: SiteTerrainResult | null = null;
  private siteConfig: SiteRuntimeConfig | null = null;
  private siteSignature: string | null = null;
  private siteAbort: AbortController | null = null;
  private siteToken = 0;
  private siteFarExtentM = 0;
  private sunDirection = new THREE.Vector3(0, 1, 0);
  private sunDistance = 200;
  private hasAppliedEnvironmentConfigOnce = false;
  private environmentRebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private hasRebuiltEnvironmentOnce = false;
  private lastRebuiltSkyEnabled: boolean | null = null;

  private lightingConfig: LightingConfig = DEFAULT_LIGHTING_CONFIG;
  private csmSystem: CSMSystem | null = null;
  private artificialLightSystem: ArtificialLightSystem | null = null;

  private renderingConfig: RenderingConfig = DEFAULT_RENDERING_CONFIG;
  private scenePostPipeline: ScenePostPipeline | null = null;
  private scenePostSignature: string | null = null;

  private hasFramedOnce = false;
  private hasAppliedOpeningShot = false;
  private hasUserMovedCamera = false;
  private contentBounds: { min: THREE.Vector3; max: THREE.Vector3; center: THREE.Vector3; size: THREE.Vector3 } | null = null;
  private cameraHelper: THREE.CameraHelper | null = null;
  private cameraTransition: {
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    startTarget: THREE.Vector3;
    endTarget: THREE.Vector3;
    startFov: number;
    endFov: number;
    startTime: number;
    durationMs: number;
  } | null = null;

  constructor(callbacks: RenderEngineCallbacks) {
    this.callbacks = callbacks;
  }

  async mount(container: HTMLDivElement, params: MountParams) {
    const token = ++this.mountToken;
    this.container = container;
    this.showPerfStats = params.showPerfStats ?? false;
    if (params.qualityConfig) this.qualityConfig = params.qualityConfig;
    const target = resolveQualityTarget(this.qualityConfig);
    this.effectiveRenderScale = target.renderScale;
    this.downgradeStep = 0;

    const renderer = await this.createRenderer(container, target, token, params.basemapAnchor ?? null);
    if (!renderer) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a20);
    this.scene = scene;

    const clippingGroup = new THREE.ClippingGroup();
    clippingGroup.clippingPlanes = NO_ACTIVE_SECTION_PLANES;
    scene.add(clippingGroup);
    this.clippingGroup = clippingGroup;
    const unclippedModelGroup = new THREE.Group();
    unclippedModelGroup.name = "RZ_UnclippedModels";
    scene.add(unclippedModelGroup);
    this.unclippedModelGroup = unclippedModelGroup;
    const sectionHelperGroup = new THREE.Group();
    sectionHelperGroup.name = "RZ_SectionHelpers";
    scene.add(sectionHelperGroup);
    this.sectionHelperGroup = sectionHelperGroup;

    const dronePathHelperGroup = new THREE.Group();
    dronePathHelperGroup.name = "RZ_DronePathHelper";
    scene.add(dronePathHelperGroup);
    this.dronePathHelperGroup = dronePathHelperGroup;

    this.isMobileViewport = window.innerWidth < MOBILE_VIEWPORT_BREAKPOINT;
    const cfg = this.cameraConfig;
    const camera = new THREE.PerspectiveCamera(
      this.isMobileViewport ? cfg.cameraFovMobile : cfg.cameraFovDesktop,
      container.clientWidth / Math.max(1, container.clientHeight),
      cfg.cameraNearClip,
      cfg.cameraFarClip
    );
    camera.position.set(30, 24, 30);
    this.camera = camera;

    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(60, 100, 40);
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(sun, sun.target, ambient);
    this.sun = sun;
    this.ambient = ambient;

    renderer.shadowMap.enabled = this.lightingConfig.shadowsEnabled;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    setShadowMapTransmitted(renderer, this.lightingConfig.transmittedShadowsEnabled);
    sun.castShadow = this.lightingConfig.shadowsEnabled;
    applySunShadowMapSize(sun, resolveQualityTarget(this.qualityConfig).shadowMapSize);
    sun.shadow.radius = this.lightingConfig.shadowSoftness;

    const artificialLightSystem = new ArtificialLightSystem(scene);
    this.artificialLightSystem = artificialLightSystem;

    const envScene = new THREE.Scene();
    this.envScene = envScene;
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem = pmrem;

    const skyMesh = new SkyMesh();
    skyMesh.scale.setScalar(SKY_DOME_SCALE);
    scene.add(skyMesh);
    this.skyMesh = skyMesh;

    const backdropMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
    });
    const backdropMesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_DOME_SCALE * 0.9, 60, 40), backdropMaterial);
    backdropMesh.visible = false;
    backdropMesh.rotation.order = "YXZ";
    scene.add(backdropMesh);
    this.backdropMesh = backdropMesh;

    const waterNormals = new THREE.TextureLoader().load(PROJECT_3D_ASSETS.waterNormals, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    });
    const waterMesh = new WaterMesh(new THREE.PlaneGeometry(WATER_PLANE_SIZE, WATER_PLANE_SIZE), {
      waterNormals,
      sunDirection: this.sunDirection.clone(),
      sunColor: 0xffffff,
      waterColor: 0x001e0f,
      distortionScale: this.environmentConfig.waterDistortionScale,
      size: this.environmentConfig.waterSize,
    });
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.visible = false;
    scene.add(waterMesh);
    this.waterMesh = waterMesh;

    const groundMaterial = this.buildGroundMaterial(this.environmentConfig);
    const groundMesh = new THREE.Mesh(new THREE.CircleGeometry(this.boundingRadius * 1.6, 48), groundMaterial);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    groundMesh.visible = this.environmentConfig.groundEnabled;
    clippingGroup.add(groundMesh);
    this.groundMesh = groundMesh;

    const cloudSystem = buildCloudSystem();
    scene.add(cloudSystem.mesh);
    this.cloudSystem = cloudSystem;

    const fogSystem = buildFogSystem();
    scene.fogNode = fogSystem.node;
    this.fogSystem = fogSystem;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    this.controls = controls;
    controls.addEventListener("start", () => {
      this.cameraTransition = null;
      this.hasUserMovedCamera = true;
      this.idleDrone.notifyInteraction(performance.now());
      this.isInteracting = true;
      if (this.qualityConfig.interactionQualityReductionEnabled && !this.isMobileViewport) {
        this.interactionRenderScale = Math.max(0.5, this.effectiveRenderScale * 0.7);
        this.applyRenderScale();
      }
    });
    controls.addEventListener("end", () => {
      this.isInteracting = false;
      this.interactionRenderScale = null;
      this.applyRenderScale();
    });

    const unitRaycaster = new THREE.Raycaster();
    const unitPointerNdc = new THREE.Vector2();
    let unitPointerDownAt: { x: number; y: number } | null = null;
    const UNIT_CLICK_DRAG_THRESHOLD_PX = 6;
    const unitIdAtPointer = (event: PointerEvent): string | null => {
      if (!this.unitsModeEnabled || this.unitRaycastTargets.length === 0) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      unitPointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      unitPointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      unitRaycaster.setFromCamera(unitPointerNdc, camera);
      for (const hit of unitRaycaster.intersectObjects(this.unitRaycastTargets, false)) {
        const hitUnitId = hit.object.userData.unitId as string | undefined;
        if (!hitUnitId) continue;
        if (this.unitRegistry.get(hitUnitId)?.rootObject.visible === false) continue;
        return hitUnitId;
      }
      return null;
    };
    renderer.domElement.addEventListener("pointermove", (event) => {
      const unitId = unitIdAtPointer(event);
      if (unitId === this.hoveredUnitId) return;
      this.hoveredUnitId = unitId;
      this.refreshUnitRegistryAndAppearance();
      this.callbacks.onUnitHover?.(unitId);
    });
    renderer.domElement.addEventListener("pointerdown", (event) => {
      unitPointerDownAt = { x: event.clientX, y: event.clientY };
    });
    renderer.domElement.addEventListener("pointerup", (event) => {
      const downAt = unitPointerDownAt;
      unitPointerDownAt = null;
      if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > UNIT_CLICK_DRAG_THRESHOLD_PX) return;
      if (!this.unitsModeEnabled) return;
      const unitId = unitIdAtPointer(event);
      this.selectedUnitId = unitId;
      this.refreshUnitRegistryAndAppearance();
      this.idleDrone.notifyInteraction(performance.now());
      this.callbacks.onUnitClick?.(unitId);
    });

    this.prefersReducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const visibilityHandler = () => {
      if (!document.hidden) this.idleDrone.notifyInteraction(performance.now());
    };
    document.addEventListener("visibilitychange", visibilityHandler);
    this.visibilityHandler = visibilityHandler;

    this.applyCameraConfig(this.cameraConfig);
    this.applyEnvironmentConfig(this.environmentConfig, true);
    this.applyLightingConfig(this.lightingConfig);
    this.applyRenderingConfig(this.renderingConfig);

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    this.dracoLoader = dracoLoader;
    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    loader.setMeshoptDecoder(MeshoptDecoder);
    this.loader = loader;

    const resizeObserver = new ResizeObserver(() => {
      const now = performance.now();
      if (now - this.lastResizeAt >= RESIZE_THROTTLE_MS) {
        if (this.resizeTimer != null) {
          clearTimeout(this.resizeTimer);
          this.resizeTimer = null;
        }
        this.performResize(container, camera, renderer);
      } else if (this.resizeTimer == null) {
        this.resizeTimer = setTimeout(() => {
          this.resizeTimer = null;
          this.performResize(container, camera, renderer);
        }, RESIZE_THROTTLE_MS);
      }
    });
    resizeObserver.observe(container);
    this.resizeObserver = resizeObserver;

    if (!this.map) {
      renderer.setAnimationLoop(() => this.renderFrame());
    }
  }

  private renderFrame() {
    const { renderer, camera, controls, scene } = this;
    if (!renderer || !camera || !controls || !scene) return;
    const now = performance.now();
    const last = this.lastFrameAt;
    this.lastFrameAt = now;
    const dtSeconds = last != null ? Math.min(0.25, (now - last) / 1000) : 0;
    if (last != null) {
      this.frameTimes.push(now - last);
      if (this.frameTimes.length > 60) this.frameTimes.shift();
    }
    controls.update();
    this.stepCameraTransition(now);
    this.idleDrone.step(now, dtSeconds, camera, controls, {
      transitionInFlight: this.cameraTransition != null,
      prefersReducedMotion: this.prefersReducedMotion,
      tabHidden: document.hidden,
    });
    if (this.showDronePath) this.updateDronePathHelper();
    this.sampleAdaptiveQuality();
    this.stepEnvironmentAnimation(dtSeconds);
    this.csmSystem?.updateFrustums();
    if (this.scenePostPipeline?.dofFocusDistance && this.renderingConfig.cameraAutoFocusEnabled) {
      this.scenePostPipeline.dofFocusDistance.value = camera.position.distanceTo(controls.target);
    }
    const blurAnchor = this.scenePostPipeline?.distanceBlurAnchor;
    if (blurAnchor) {
      const center = blurAnchor.center.value as THREE.Vector3;
      if (this.contentBounds) center.copy(this.contentBounds.center);
      else center.set(0, 0, 0);
      blurAnchor.buildingRadius.value = this.boundingRadius;
    }
    clipUnitOutlinesToSection(this.unitOutlineByMesh, this.activeSectionPlanes);
    if (this.scenePostPipeline) this.scenePostPipeline.pipeline.render();
    else renderer.render(scene, camera);
    this.cameraHelper?.update();
    this.samplePerfStats();
  }

  private samplePerfStats() {
    const renderer = this.renderer;
    if (!this.showPerfStats || !renderer) return;
    this.perfSampleCounter += 1;
    if (this.perfSampleCounter % PERF_SAMPLE_EVERY_N_FRAMES !== 0) return;
    const frames = this.frameTimes;
    const avgFrameMs = frames.length ? frames.reduce((a, b) => a + b, 0) / frames.length : 0;
    const callsNow = renderer.info.render.calls;
    const drawCalls =
      this.lastDrawCallMark == null ? 0 : Math.max(0, Math.round((callsNow - this.lastDrawCallMark) / PERF_SAMPLE_EVERY_N_FRAMES));
    this.lastDrawCallMark = callsNow;
    this.callbacks.onPerfStats({
      fps: avgFrameMs > 0 ? Math.round(1000 / avgFrameMs) : 0,
      frameTimeMs: Math.round(avgFrameMs * 10) / 10,
      drawCalls,
      triangles: renderer.info.render.triangles,
      textures: renderer.info.memory.textures,
      dpr: renderer.getPixelRatio(),
      // LineSegments2 is never clipped by a ClippingGroup (it extends Mesh but
      // renders through its own shader), so unit outlines are cut on the CPU here.
      outlineClip: clipUnitOutlinesState(this.unitOutlineByMesh, this.activeSectionPlanes),
    });
  }

  private async createRenderer(
    container: HTMLDivElement,
    target: { renderScale: number; dprCap: number },
    mountToken: number,
    basemapAnchor: BasemapAnchor | null
  ): Promise<THREE.WebGPURenderer | null> {
    const renderer = basemapAnchor
      ? await this.createBasemapRenderer(container, mountToken)
      : await this.createStandardRenderer(mountToken);
    if (!renderer) return null;

    const pixelRatio = Math.min(window.devicePixelRatio, target.dprCap);
    renderer.setPixelRatio(pixelRatio);
    if (basemapAnchor) {
      renderer.setSize(container.clientWidth, container.clientHeight, false);
    } else {
      renderer.setSize(container.clientWidth * this.effectiveRenderScale, container.clientHeight * this.effectiveRenderScale, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      container.appendChild(renderer.domElement);
    }
    renderer.toneMapping = TONE_MAPPING_MAP[this.renderingConfig.toneMapping];
    renderer.toneMappingExposure = this.renderingConfig.exposure;
    this.renderer = renderer;
    this.watchForContextLoss(renderer);
    this.publishRendererFacts(renderer);
    return renderer;
  }

  private watchForContextLoss(renderer: THREE.WebGPURenderer) {
    const canvas = renderer.domElement;
    this.watchForDeviceErrors(renderer);
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.contextLostCount += 1;
      this.publishRendererFacts(renderer);
      this.callbacks.onContextLost?.();
    });
    const device = (renderer.backend as unknown as { device?: { lost?: Promise<unknown> } })?.device;
    device?.lost
      ?.then(() => {
        this.contextLostCount += 1;
        this.publishRendererFacts(renderer);
        this.callbacks.onContextLost?.();
      })
      .catch(() => {});
  }

  private watchForDeviceErrors(renderer: THREE.WebGPURenderer) {
    const device = (renderer.backend as unknown as {
      device?: { onuncapturederror?: ((event: { error?: { message?: string } }) => void) | null };
    })?.device;
    if (!device) return;
    device.onuncapturederror = (event) => {
      const message = String(event?.error?.message ?? "unknown GPU error").split("\n")[0].slice(0, 200);
      if (this.gpuErrors.includes(message)) return;
      if (this.gpuErrors.length >= MAX_REPORTED_GPU_ERRORS) return;
      this.gpuErrors.push(message);
      this.publishRendererFacts(renderer);
    };
  }

  private publishRendererFacts(renderer: THREE.WebGPURenderer) {
    if (!this.callbacks.onRendererFacts) return;
    const backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean })?.isWebGPUBackend === true ? "webgpu" : "webgl2";
    let glRenderer: string | null = null;
    let maxTextureSize: number | null = null;
    if (backend === "webgl2") {
      const gl = renderer.domElement.getContext("webgl2") as WebGL2RenderingContext | null;
      if (gl) {
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        glRenderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null;
        maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      }
    }
    const size = new THREE.Vector2();
    renderer.getDrawingBufferSize(size);
    this.callbacks.onRendererFacts({
      backend,
      webgpuAvailable: typeof navigator !== "undefined" && "gpu" in navigator && (navigator as Navigator & { gpu?: unknown }).gpu != null,
      glRenderer,
      maxTextureSize,
      drawingBufferPx: { width: Math.round(size.x), height: Math.round(size.y) },
      pixelRatio: renderer.getPixelRatio(),
      contextLostCount: this.contextLostCount,
      gpuErrors: [...this.gpuErrors],
    });
  }

  private async createStandardRenderer(mountToken: number): Promise<THREE.WebGPURenderer | null> {
    const renderer = new THREE.WebGPURenderer({
      antialias: !this.renderingConfig.antialiasEnabled,
      forceWebGL: this.qualityConfig.renderingMode === "webgl2" || (this.qualityConfig.renderingMode === "auto" && isTouchPhoneOrTablet()),
    });
    try {
      await renderer.init();
    } catch {
      if (mountToken === this.mountToken) this.callbacks.onWebglFail();
      return null;
    }
    if (mountToken !== this.mountToken) {
      renderer.dispose();
      return null;
    }
    return renderer;
  }

  private async createBasemapRenderer(container: HTMLDivElement, mountToken: number): Promise<THREE.WebGPURenderer | null> {
    const accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!accessToken) {
      if (mountToken === this.mountToken) this.callbacks.onWebglFail();
      return null;
    }
    mapboxgl.accessToken = accessToken;

    const map = new mapboxgl.Map({
      container,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [0, 0],
      zoom: 2,
      interactive: false,
      attributionControl: false,
    });

    const renderer = await new Promise<THREE.WebGPURenderer | null>((resolve) => {
      const layer = new StudioBasemapLayer({
        onRendererReady: (r) => resolve(r),
        onRendererFailed: () => resolve(null),
        onFrame: () => this.renderFrame(),
      });
      this.basemapLayer = layer;
      map.on("load", () => map.addLayer(layer));
    });

    if (!renderer || mountToken !== this.mountToken) {
      map.remove();
      this.basemapLayer = null;
      renderer?.dispose();
      if (mountToken === this.mountToken && !renderer) this.callbacks.onWebglFail();
      return null;
    }

    this.map = map;
    this.startBasemapRepaintLoop();
    return renderer;
  }

  private startBasemapRepaintLoop() {
    const tick = () => {
      this.map?.triggerRepaint();
      this.basemapRafId = requestAnimationFrame(tick);
    };
    this.basemapRafId = requestAnimationFrame(tick);
  }

  private stepEnvironmentAnimation(dtSeconds: number) {
    const { camera, fogSystem, cloudSystem, environmentConfig } = this;
    if (!camera) return;
    fogSystem?.update(environmentConfig, this.sunDirection, dtSeconds);
    cloudSystem?.update(environmentConfig, this.sunDirection, camera.position, dtSeconds);
  }

  private stepCameraTransition(now: number) {
    const t = this.cameraTransition;
    const { camera, controls } = this;
    if (!t || !camera || !controls) return;
    const elapsed = now - t.startTime;
    const p = Math.min(1, elapsed / Math.max(1, t.durationMs));
    const eased = p * p * (3 - 2 * p);
    camera.position.lerpVectors(t.startPos, t.endPos, eased);
    controls.target.lerpVectors(t.startTarget, t.endTarget, eased);
    camera.fov = t.startFov + (t.endFov - t.startFov) * eased;
    camera.updateProjectionMatrix();
    if (p >= 1) this.cameraTransition = null;
  }

  async syncModels(entries: DetailModelEntry[]) {
    this.lastSyncEntries = entries;
    const scene = this.scene;
    const loader = this.loader;
    const clippingGroup = this.clippingGroup;
    const unclippedModelGroup = this.unclippedModelGroup;
    if (!scene || !loader || !clippingGroup || !unclippedModelGroup) return;
    const token = ++this.syncToken;
    this.callbacks.onModelLoadStatus?.({ state: "loading" });
    const failedModels: string[] = [];
    let forbidden = false;

    const groupFor = (entry: DetailModelEntry) =>
      isSlotCutBySections(entry) ? clippingGroup : unclippedModelGroup;

    const wantedSlotIds = new Set(entries.filter((e) => e.model.enabled !== false).map((e) => e.slotId));
    for (const [slotId, root] of this.modelRootsBySlot) {
      if (!wantedSlotIds.has(slotId)) {
        root.removeFromParent();
        this.modelRootsBySlot.delete(slotId);
        this.loadedGlbUrlBySlot.delete(slotId);
      }
    }

    let loadedSomethingNew = false;
    for (const entry of entries) {
      const { slotId, model } = entry;
      if (model.enabled === false) continue;
      const existingRoot = this.modelRootsBySlot.get(slotId);
      const existingUrl = this.loadedGlbUrlBySlot.get(slotId);
      const parentGroup = groupFor(entry);

      if (existingRoot && existingUrl === model.glbUrl) {
        if (existingRoot.parent !== parentGroup) parentGroup.add(existingRoot);
        this.applyTransform(existingRoot, model);
        existingRoot.visible = model.visible !== false;
        existingRoot.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = model.castShadow !== false;
          mesh.receiveShadow = model.receiveShadow !== false;
        });
        this.applyNodeOverrides(existingRoot, model);
        applyTransmittedShadows(existingRoot, this.lightingConfig);
        continue;
      }

      try {
        const gltf = await loader.loadAsync(model.glbUrl);
        if (token !== this.syncToken) return;
        if (existingRoot) existingRoot.removeFromParent();
        const root = gltf.scene;
        if (isTouchPhoneOrTablet()) capTextureSizes(root, MOBILE_MAX_TEXTURE_PX);
        this.applyTransform(root, model);
        root.visible = model.visible !== false;
        root.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = model.castShadow !== false;
          mesh.receiveShadow = model.receiveShadow !== false;
        });
        this.applyNodeOverrides(root, model);
        applyTransmittedShadows(root, this.lightingConfig);
        parentGroup.add(root);
        this.modelRootsBySlot.set(slotId, root);
        this.loadedGlbUrlBySlot.set(slotId, model.glbUrl);
        loadedSomethingNew = true;
      } catch (err) {
        if (token !== this.syncToken) return;
        failedModels.push(entry.slotName ?? slotId);
        const response = (err as { response?: Response })?.response;
        forbidden ||= response?.status === 403;
        this.callbacks.onModelLoadStatus?.({ state: "failed", models: [...failedModels], forbidden });
        console.error("RenderEngine: GLB load failed", model.glbUrl, err);
      }
    }

    if (token !== this.syncToken) return;

    for (const entry of entries) {
      const parentSlotId = entry.transformParentSlotId;
      if (!parentSlotId) continue;
      const childRoot = this.modelRootsBySlot.get(entry.slotId);
      const parentRoot = this.modelRootsBySlot.get(parentSlotId);
      if (!childRoot || !parentRoot) continue;
      childRoot.position.copy(parentRoot.position);
      childRoot.rotation.copy(parentRoot.rotation);
      childRoot.scale.copy(parentRoot.scale);
    }

    this.loadedRoots = Array.from(this.modelRootsBySlot.values());
    this.refreshUnitRegistryAndAppearance();
    if (loadedSomethingNew) this.frameLoadedContent();
    this.callbacks.onModelLoadStatus?.(
      failedModels.length ? { state: "failed", models: failedModels, forbidden } : { state: "ready" }
    );
  }

  private refreshUnitRegistryAndAppearance() {
    clearUnitSelectionScale(this.unitSelectionScaleOriginals);
    const rootObjectsByName = new Map<string, THREE.Object3D>();
    const allLinks: UnitMeshLink[] = [];
    const unitsById = new Map<string, Unit>();
    const poiByUnitId = new Map<
      string,
      { poiYawDeg: number | null; poiEnabled: boolean; poiDistanceOverride: number | null; poiHeightOverride: number | null }
    >();
    let anyStatusPreviewEnabled = false;

    for (const { slotId, model, units, statusPreviewEnabled } of this.lastSyncEntries) {
      const root = this.modelRootsBySlot.get(slotId);
      if (!root || model.enabled === false) continue;
      for (const [name, obj] of findUnitRootObjects(root)) rootObjectsByName.set(name, obj);
      for (const link of model.unitLinks) {
        allLinks.push(link);
        poiByUnitId.set(link.unitId, {
          poiYawDeg: link.poiYawDeg ?? null,
          poiEnabled: link.poiEnabled ?? true,
          poiDistanceOverride: link.poiDistanceOverride ?? null,
          poiHeightOverride: link.poiHeightOverride ?? null,
        });
      }
      for (const u of units ?? []) unitsById.set(u.id, u);
      if (statusPreviewEnabled ?? true) anyStatusPreviewEnabled = true;
    }

    this.unitRaycastTargets = applyUnitBoxAppearance(
      rootObjectsByName,
      allLinks,
      unitsById,
      anyStatusPreviewEnabled,
      this.selectedUnitId,
      this.hoveredUnitId,
      this.unitsConfig,
      this.originalMaterials,
      this.unitMaterialCache,
      this.unitOutlineByMesh
    );
    let sceneCenter: THREE.Vector3 | null = null;
    if (this.loadedRoots.length > 0) {
      const bounds = new THREE.Box3();
      for (const root of this.loadedRoots) bounds.expandByObject(root);
      if (!bounds.isEmpty()) sceneCenter = bounds.getCenter(new THREE.Vector3());
    }
    this.unitRegistry = buildUnitRegistry(rootObjectsByName, allLinks, unitsById, poiByUnitId, sceneCenter);

    if (this.unitsConfig.unitBlocksEnabled && this.unitsConfig.unitBlocksSelectedScaleEnabled && this.selectedUnitId) {
      const selected = this.unitRegistry.get(this.selectedUnitId);
      if (selected) {
        applyUnitSelectionScale(
          selected.rootObject,
          this.unitsConfig.unitBlocksSelectedScale,
          this.unitSelectionScaleOriginals
        );
      }
    }
    this.applyUnitVisibility();
  }

  private applyUnitVisibility() {
    for (const entry of this.unitRegistry.values()) {
      const passesFilter = this.unitStatusFilters[entry.status];
      const passesIdFilter = this.unitIdFilter == null || this.unitIdFilter.has(entry.unitId);
      const passesIsolate = this.isolatedUnitId == null || this.isolatedUnitId === entry.unitId;
      entry.rootObject.visible = this.unitsModeEnabled && passesFilter && passesIdFilter && passesIsolate;
    }
  }

  setUnitsMode(enabled: boolean) {
    this.unitsModeEnabled = enabled;
    this.applyUnitVisibility();
  }

  setUnitStatusFilters(filters: { available: boolean; reserved: boolean; sold: boolean }) {
    this.unitStatusFilters = filters;
    this.applyUnitVisibility();
  }

  setUnitIdFilter(unitIds: string[] | null) {
    this.unitIdFilter = unitIds == null ? null : new Set(unitIds);
    this.applyUnitVisibility();
  }

  isolateUnit(unitId: string | null) {
    this.isolatedUnitId = unitId;
    this.applyUnitVisibility();
  }

  hoverUnit(unitId: string | null) {
    if (this.hoveredUnitId === unitId) return;
    this.hoveredUnitId = unitId;
    this.refreshUnitRegistryAndAppearance();
  }

  refreshUnitStatuses(units: Unit[]) {
    this.lastSyncEntries = this.lastSyncEntries.map((entry) => ({ ...entry, units }));
    this.refreshUnitRegistryAndAppearance();
  }

  setUnitsConfig(config: UnitsConfig) {
    this.unitsConfig = config;
    this.refreshUnitRegistryAndAppearance();
  }

  private applyTransform(root: THREE.Object3D, model: ProjectDetailModel) {
    root.scale.setScalar(model.scale);
    root.rotation.set(
      (model.rotationXDeg * Math.PI) / 180,
      (model.rotationDeg * Math.PI) / 180,
      (model.rotationZDeg * Math.PI) / 180
    );
    root.position.set(model.positionX, model.altitudeOffset, model.positionZ);
  }

  private applyNodeOverrides(root: THREE.Object3D, model: ProjectDetailModel) {
    const overrides = model.nodeOverrides ?? [];
    const manifest = model.sceneManifest ?? [];
    const nodeToOverride = new Map(overrides.map((override) => [override.nodeId, override]));
    const nameToOverride = new Map<string, NodeOverride>(
      manifest.flatMap((n: SceneManifestNode) => {
        const o = nodeToOverride.get(n.nodeId);
        return o ? [[n.name, o] as const] : [];
      })
    );

    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = cleanGlbNodeName(mesh.name);
      if (UNIT_NODE_PATTERN.test(name)) return;
      if (!this.originalMaterials.has(mesh)) {
        this.originalMaterials.set(mesh, normalizeMaterials(mesh.material));
      }
      const originals = this.originalMaterials.get(mesh)!;
      const override = nameToOverride.get(name);

      const currentIsOriginal = normalizeMaterials(mesh.material).every((m, i) => m === originals[i]);

      if (!override || override.materialOverrideEnabled === false) {
        if (!currentIsOriginal) {
          normalizeMaterials(mesh.material).forEach((m) => m.dispose());
          mesh.material = originals.length === 1 ? originals[0] : originals;
        }
        if (override?.visible === false) mesh.visible = false;
        return;
      }

      if (!currentIsOriginal) normalizeMaterials(mesh.material).forEach((m) => m.dispose());
      const built = originals.map((orig) => buildOverriddenMaterial(orig, override));
      mesh.material = built.length === 1 ? built[0] : built;
      if (override.visible === false) mesh.visible = false;
    });
  }

  setSelectedUnit(unitId: string | null) {
    this.selectedUnitId = unitId;
    this.refreshUnitRegistryAndAppearance();
  }

  focusUnit(unitId: string): boolean {
    const entry = this.unitRegistry.get(unitId);
    const camera = this.camera;
    const controls = this.controls;
    if (!entry || !camera || !controls || !entry.poiEnabled || !this.unitsConfig.unitPoiCameraEnabled) return false;
    this.idleDrone.notifyInteraction(performance.now());

    const poiHalfFovRad = Math.max(0.01, (this.unitsConfig.unitPoiCameraFov * Math.PI) / 360);
    const framedDistance = entry.worldBoundingSphere.radius / Math.tan(poiHalfFovRad * 0.6);
    const distance =
      entry.poiDistanceOverride ??
      Math.max(entry.worldBoundingSphere.radius * this.unitsConfig.unitPoiCameraDistanceMultiplier, framedDistance);
    const height = entry.poiHeightOverride ?? this.unitsConfig.unitPoiCameraHeightOffset;
    const yawRad = (entry.poiYawDeg * Math.PI) / 180;
    const offset = new THREE.Vector3(Math.sin(yawRad) * distance, height, Math.cos(yawRad) * distance);
    const endPos = entry.worldCenter.clone().add(offset);
    const endTarget = entry.worldCenter.clone();

    this.cameraTransition = {
      startPos: camera.position.clone(),
      endPos,
      startTarget: controls.target.clone(),
      endTarget,
      startFov: camera.fov,
      endFov: this.unitsConfig.unitPoiCameraFov,
      startTime: performance.now(),
      durationMs: Math.max(1, this.unitsConfig.unitPoiTransitionMs),
    };
    return true;
  }

  getUnitViewportState(unitId: string): { onScreen: boolean; coverage: number; poiAuthored: boolean } | null {
    const entry = this.unitRegistry.get(unitId);
    const camera = this.camera;
    if (!entry || !camera) return null;
    const centre = entry.worldCenter.clone();
    const distance = camera.position.distanceTo(centre);
    const ndc = centre.project(camera);
    const onScreen = ndc.z > -1 && ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
    const halfFovRad = (camera.fov * Math.PI) / 360;
    const coverage =
      distance > 1e-6 && halfFovRad > 0 ? Math.atan(entry.worldBoundingSphere.radius / distance) / halfFovRad : 1;
    const poiAuthored =
      entry.poiYawAuthored || entry.poiDistanceOverride != null || entry.poiHeightOverride != null;
    return { onScreen, coverage, poiAuthored };
  }

  revealUnit(unitId: string, screenBiasY = 0, frameFraction = 0.35): boolean {
    const entry = this.unitRegistry.get(unitId);
    if (!entry) return false;
    return this.revealSphere(entry.worldCenter, entry.worldBoundingSphere.radius, screenBiasY, frameFraction);
  }

  revealUnits(unitIds: string[], screenBiasY = 0, frameFraction = 0.5): boolean {
    const bounds = new THREE.Box3();
    let matched = 0;
    for (const unitId of unitIds) {
      const entry = this.unitRegistry.get(unitId);
      if (!entry) continue;
      bounds.union(entry.worldBounds);
      matched += 1;
    }
    if (matched === 0) return false;
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    return this.revealSphere(sphere.center, sphere.radius, screenBiasY, frameFraction);
  }

  revealArea(
    area: { centerX: number; centerZ: number; y: number; radius: number },
    screenBiasY = 0,
    frameFraction = 0.7
  ): boolean {
    return this.revealSphere(
      new THREE.Vector3(area.centerX, area.y, area.centerZ),
      area.radius,
      screenBiasY,
      frameFraction
    );
  }

  private revealSphere(
    center: THREE.Vector3,
    sphereRadius: number,
    screenBiasY: number,
    frameFraction: number
  ): boolean {
    const camera = this.camera;
    const controls = this.controls;
    if (!camera || !controls) return false;
    this.idleDrone.notifyInteraction(performance.now());

    const endTarget = center.clone();
    const direction = camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 1e-8) direction.set(0, 0.35, 1);
    direction.normalize();

    const halfFovRad = (camera.fov * Math.PI) / 360;
    const radius = Math.max(sphereRadius, 1e-3);
    const targetAngle = Math.max(0.01, halfFovRad * frameFraction);
    const distance = Math.max(radius * 2, radius / Math.tan(targetAngle));

    if (screenBiasY !== 0) {
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction);
      if (right.lengthSq() > 1e-8) {
        const up = new THREE.Vector3().crossVectors(direction, right.normalize()).normalize();
        endTarget.addScaledVector(up, -screenBiasY * Math.tan(halfFovRad) * distance);
      }
    }

    this.cameraTransition = {
      startPos: camera.position.clone(),
      endPos: endTarget.clone().add(direction.multiplyScalar(distance)),
      startTarget: controls.target.clone(),
      endTarget,
      startFov: camera.fov,
      endFov: camera.fov,
      startTime: performance.now(),
      durationMs: Math.max(1, this.unitsConfig.unitPoiTransitionMs),
    };
    return true;
  }

  resetUnitCamera() {
    this.selectedUnitId = null;
    this.isolatedUnitId = null;
    this.refreshUnitRegistryAndAppearance();
    this.resetView();
  }

  getUnitRegistrySnapshot(): { unitId: string; unitCode: string; poiYawDeg: number }[] {
    return Array.from(this.unitRegistry.values()).map((e) => ({ unitId: e.unitId, unitCode: e.unitCode, poiYawDeg: e.poiYawDeg }));
  }

  computeGroundAlignOffset(slotId: string): number | null {
    const root = this.modelRootsBySlot.get(slotId);
    if (!root) return null;
    const box = new THREE.Box3().setFromObject(root);
    const currentY = root.position.y;
    const lowestY = box.min.y;
    return currentY - lowestY;
  }

  getContentBounds(): { centerX: number; centerZ: number; minY: number; maxY: number; sizeX: number; sizeZ: number } | null {
    const b = this.contentBounds;
    if (!b) return null;
    return { centerX: b.center.x, centerZ: b.center.z, minY: b.min.y, maxY: b.max.y, sizeX: b.size.x, sizeZ: b.size.z };
  }

  private collectClippableMeshes(): THREE.Mesh[] {
    const unitSlotRoots = new Set<THREE.Object3D>();
    for (const entry of this.lastSyncEntries) {
      if (entry.slotRole !== "units") continue;
      const root = this.modelRootsBySlot.get(entry.slotId);
      if (root) unitSlotRoots.add(root);
    }

    const meshes: THREE.Mesh[] = [];
    const walk = (obj: THREE.Object3D) => {
      if (obj.visible === false) return;
      if (unitSlotRoots.has(obj)) return;
      if (obj.userData.isUnitBlock || obj.userData.isUnitOutline) return;
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) meshes.push(mesh);
      for (const child of obj.children) walk(child);
    };
    if (this.clippingGroup) walk(this.clippingGroup);
    return meshes;
  }

  private clearSectionFillMeshes() {
    for (const mesh of this.sectionFillMeshes) {
      this.sectionFillClippingGroup?.remove(mesh);
    }
    this.sectionFillMeshes = [];
  }

  private rebuildSectionCap(section: Section | null, showIndicator: boolean) {
    const helpers = this.sectionHelperGroup;
    if (!helpers) return;
    if (this.sectionIndicatorMesh) {
      helpers.remove(this.sectionIndicatorMesh);
      this.sectionIndicatorMesh.geometry.dispose();
      this.sectionIndicatorMesh = null;
    }
    this.clearSectionFillMeshes();
    if (!section) return;

    if (section.fillGapsEnabled) {
      if (!this.sectionFillClippingGroup) {
        this.sectionFillClippingGroup = new THREE.ClippingGroup();
        helpers.add(this.sectionFillClippingGroup);
      }
      this.sectionFillClippingGroup.clippingPlanes = buildSectionPlanes(section);

      if (!this.sectionFillMaterial) {
        this.sectionFillMaterial = new THREE.MeshBasicMaterial({ color: section.fillColor, side: THREE.BackSide });
      } else {
        this.sectionFillMaterial.color.set(section.fillColor);
      }

      for (const source of this.collectClippableMeshes()) {
        const fillMesh = new THREE.Mesh(source.geometry, this.sectionFillMaterial);
        fillMesh.matrixAutoUpdate = false;
        fillMesh.matrix.copy(source.matrixWorld);
        fillMesh.frustumCulled = false;
        fillMesh.castShadow = false;
        fillMesh.receiveShadow = false;
        fillMesh.renderOrder = 10;
        this.sectionFillClippingGroup.add(fillMesh);
        this.sectionFillMeshes.push(fillMesh);
      }
    } else if (showIndicator) {
      const geometry = buildSectionCapGeometry(section);
      if (!this.sectionIndicatorMaterial) {
        this.sectionIndicatorMaterial = new THREE.MeshBasicMaterial({
          color: SECTION_INDICATOR_COLOR,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
      }
      const mesh = new THREE.Mesh(geometry, this.sectionIndicatorMaterial);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 10;
      helpers.add(mesh);
      this.sectionIndicatorMesh = mesh;
    }
  }

  activateSection(section: Section | null, options?: { showIndicator?: boolean }) {
    this.activeSectionId = section?.id ?? null;
    this.activeSectionPlanes = section ? buildSectionPlanes(section) : null;
    if (this.clippingGroup) {
      this.clippingGroup.clippingPlanes = this.activeSectionPlanes ?? NO_ACTIVE_SECTION_PLANES;
    }
    this.rebuildSectionCap(section, options?.showIndicator !== false);
  }

  getActiveSectionId(): string | null {
    return this.activeSectionId;
  }

  private frameLoadedContent() {
    const { camera, controls, loadedRoots } = this;
    if (!camera || !controls || loadedRoots.length === 0) return;
    const box = new THREE.Box3();
    loadedRoots.forEach((root) => box.union(new THREE.Box3().setFromObject(root)));
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    this.contentBounds = { min: box.min.clone(), max: box.max.clone(), center: center.clone(), size: size.clone() };
    this.boundingRadius = Math.max(size.x, size.y, size.z, 1) * 0.65 || 20;

    if (!this.hasFramedOnce) {
      this.hasFramedOnce = true;
      const startDistance = this.boundingRadius * this.cameraConfig.cameraStartDistanceMultiplier;
      controls.target.copy(center);
      camera.position.set(center.x + startDistance, center.y + startDistance * 0.7, center.z + startDistance);
      this.idleDrone.notifyInteraction(performance.now());
    }
    this.idleDrone.setBounds({ center: center.clone(), buildingHeight: Math.max(size.y, 1), groundMinY: box.min.y, boundingRadius: this.boundingRadius });
    if (this.showDronePath) this.rebuildDronePathHelper();
    this.applyCameraConfig(this.cameraConfig);
    this.sunDistance = Math.max(200, this.boundingRadius * 3);
    this.applyEnvironmentConfig(this.environmentConfig, false);

    if (this.sun) {
      const shadowSpan = this.boundingRadius * 1.5;
      this.sun.shadow.camera.left = -shadowSpan;
      this.sun.shadow.camera.right = shadowSpan;
      this.sun.shadow.camera.top = shadowSpan;
      this.sun.shadow.camera.bottom = -shadowSpan;
      this.sun.shadow.camera.near = Math.max(0.1, this.sunDistance - this.boundingRadius * 2);
      this.sun.shadow.camera.far = this.sunDistance + this.boundingRadius * 2;
      this.sun.shadow.bias = -0.00005 * this.boundingRadius;
      this.sun.shadow.normalBias = 0.01 * this.boundingRadius;
      this.sun.shadow.camera.updateProjectionMatrix();
      this.csmSystem?.updateFrustums();
    }

    this.maybeApplyOpeningShot();
  }

  private maybeApplyOpeningShot() {
    const { camera, controls } = this;
    if (!camera || !controls) return;
    if (this.hasAppliedOpeningShot || this.hasUserMovedCamera || !this.hasFramedOnce) return;
    const opening = this.cameraConfig.cameraPresets?.[0];
    if (!opening) return;
    this.hasAppliedOpeningShot = true;
    camera.position.set(opening.position.x, opening.position.y, opening.position.z);
    controls.target.set(opening.target.x, opening.target.y, opening.target.z);
    camera.fov = opening.fov;
    camera.updateProjectionMatrix();
    controls.update();
    this.idleDrone.notifyInteraction(performance.now());
  }

  resetView() {
    this.hasFramedOnce = false;
    this.frameLoadedContent();
  }

  setPerfStatsEnabled(enabled: boolean) {
    this.showPerfStats = enabled;
    if (!enabled) this.callbacks.onPerfStats(null);
  }

  private performResize(container: HTMLDivElement, camera: THREE.PerspectiveCamera, renderer: THREE.WebGPURenderer) {
    this.lastResizeAt = performance.now();
    if (!container.clientWidth || !container.clientHeight) return;
    this.isMobileViewport = window.innerWidth < MOBILE_VIEWPORT_BREAKPOINT;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    if (this.map) {
      renderer.setSize(container.clientWidth, container.clientHeight, false);
    } else {
      renderer.setSize(container.clientWidth * this.effectiveRenderScale, container.clientHeight * this.effectiveRenderScale, false);
    }
  }

  getEffectiveRenderScale(): number {
    return this.effectiveRenderScale;
  }

  setCameraConfig(config: CameraConfig) {
    this.cameraConfig = config;
    this.applyCameraConfig(config);
    this.maybeApplyOpeningShot();
  }

  private applyCameraConfig(config: CameraConfig) {
    const { camera, controls, container } = this;
    if (!camera || !controls || !container) return;
    this.isMobileViewport = window.innerWidth < MOBILE_VIEWPORT_BREAKPOINT;
    camera.fov = this.isMobileViewport ? config.cameraFovMobile : config.cameraFovDesktop;
    camera.near = config.cameraNearClip;
    camera.far = Math.max(config.cameraFarClip, this.boundingRadius * 8, SKY_DOME_SCALE * 1.1, this.siteFarExtentM);
    camera.updateProjectionMatrix();

    controls.enableRotate = config.cameraOrbitEnabled;
    controls.enablePan = config.cameraPanEnabled;
    controls.enableZoom = config.cameraZoomEnabled;
    controls.enableDamping = config.cameraDampingEnabled;
    controls.dampingFactor = 0.08;
    controls.autoRotate = config.autoRotate && !config.idleDroneEnabled;
    controls.minDistance = this.boundingRadius * config.cameraMinDistanceMultiplier;
    controls.maxDistance = this.boundingRadius * config.cameraMaxDistanceMultiplier;
    controls.minPolarAngle = THREE.MathUtils.degToRad(config.cameraMinPolarDeg);
    controls.maxPolarAngle = THREE.MathUtils.degToRad(config.cameraMaxPolarDeg);
    controls.minAzimuthAngle = config.cameraMinAzimuthDeg != null ? THREE.MathUtils.degToRad(config.cameraMinAzimuthDeg) : -Infinity;
    controls.maxAzimuthAngle = config.cameraMaxAzimuthDeg != null ? THREE.MathUtils.degToRad(config.cameraMaxAzimuthDeg) : Infinity;
    this.idleDrone.setConfig(config);
    if (this.showDronePath) this.rebuildDronePathHelper();
  }

  private isMobileQualityTier(): boolean {
    return this.qualityConfig.qualityPreset === "mobile_low" || this.qualityConfig.qualityPreset === "mobile_high";
  }

  private resolveGlobalSunVector(config: EnvironmentConfig): { elevationDeg: number; azimuthDeg: number } {
    if (!config.solarControllerEnabled) {
      const manualAz = (((config.sunAzimuthDeg + config.siteRotationDeg) % 360) + 360) % 360;
      return { elevationDeg: config.sunElevationDeg, azimuthDeg: manualAz };
    }
    const raw =
      config.solarPathMode === "geographic"
        ? geographicSunPosition(new Date(config.simulationDate), config.geoLatitude, config.geoLongitude, config.viewerTimeHours)
        : sunPositionForAnchors(config.viewerTimeHours, config.solarAnchors);
    const northDeg = config.northOffsetDeg + config.siteRotationDeg;
    return { elevationDeg: raw.elevationDeg, azimuthDeg: (((raw.azimuthDeg + northDeg) % 360) + 360) % 360 };
  }

  private buildGroundMaterial(config: EnvironmentConfig): THREE.MeshStandardNodeMaterial {
    const groundColorUniform = uniform(new THREE.Color(config.groundColor));
    const groundFogColorUniform = uniform(new THREE.Color(resolveFogColor(config)));
    const groundFogRadiusUniform = uniform(Math.max(1, config.groundFogRadius));
    const groundFogStrengthUniform = uniform(config.fogEnabled && config.groundFogEnabled ? 1 : 0);
    this.groundColorUniform = groundColorUniform;
    this.groundFogColorUniform = groundFogColorUniform;
    this.groundFogRadiusUniform = groundFogRadiusUniform;
    this.groundFogStrengthUniform = groundFogStrengthUniform;

    const cloudShadowStrength = uniform(0);
    const cloudHeightU = uniform(config.cloudHeight);
    const cloudScaleU = uniform(Math.max(0.0001, config.cloudScale));
    const cloudCoverageU = uniform(config.cloudCoverage);
    const cloudWindU = uniform(new THREE.Vector2(0, 0));
    const sunDirU = uniform(this.sunDirection.clone());
    this.groundCloudShadowStrengthUniform = cloudShadowStrength;
    this.groundCloudHeightUniform = cloudHeightU;
    this.groundCloudScaleUniform = cloudScaleU;
    this.groundCloudCoverageUniform = cloudCoverageU;
    this.groundCloudWindUniform = cloudWindU;
    this.groundSunDirectionUniform = sunDirU;

    const material = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
    const distanceFromOrigin = tslLength(positionWorld.xz);
    const innerRadius = groundFogRadiusUniform.mul(0.7);
    const fade = tslSmoothstep(innerRadius, groundFogRadiusUniform, distanceFromOrigin).mul(groundFogStrengthUniform);
    const baseColor = tslMix(groundColorUniform, groundFogColorUniform, fade);
    const shadow = cloudShadowFactor(positionWorld, sunDirU, cloudHeightU, cloudScaleU, cloudCoverageU, cloudWindU, cloudShadowStrength);
    material.colorNode = baseColor.mul(shadow);
    return material;
  }

  setSiteConfig(config: SiteRuntimeConfig) {
    const previous = this.siteConfig;
    this.siteConfig = config;
    if (!this.scene) return;

    const hasLocation = config.latitude != null && config.longitude != null;
    const active = config.siteEnabled && hasLocation;
    const signature = active
      ? [config.latitude, config.longitude, config.siteRadiusM, config.siteTerrainEnabled, config.siteImageryEnabled].join("|")
      : null;

    if (signature !== this.siteSignature) {
      this.siteSignature = signature;
      void this.rebuildSite(active ? config : null);
    } else {
      this.applySiteTransform();
      this.applySiteMaterial();
    }

    const wasActive = !!previous && previous.siteEnabled && previous.latitude != null && previous.longitude != null;
    if (wasActive !== active) this.applyEnvironmentConfig(this.environmentConfig, false);
  }

  private hasActiveSite(): boolean {
    return !!this.siteGroup && !!this.siteResult;
  }

  private async rebuildSite(config: SiteRuntimeConfig | null) {
    const token = ++this.siteToken;
    this.siteAbort?.abort();
    this.siteAbort = null;
    this.siteFarExtentM = 0;
    this.disposeSite();

    if (!config || !this.scene) {
      if (this.scene) this.applyEnvironmentConfig(this.environmentConfig, false);
      return;
    }

    const accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!accessToken) return;

    const controller = new AbortController();
    this.siteAbort = controller;
    this.callbacks.onSiteStatus?.({ state: "loading" });

    let result: SiteTerrainResult | null = null;
    let siteFailureReason: string | undefined;
    try {
      result = await buildSiteTerrain({
        latitude: config.latitude as number,
        longitude: config.longitude as number,
        radiusM: config.siteRadiusM,
        terrainEnabled: config.siteTerrainEnabled,
        imageryEnabled: config.siteImageryEnabled,
        accessToken,
        signal: controller.signal,
      });
    } catch (error) {
      result = null;
      siteFailureReason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }

    if (token !== this.siteToken || !this.scene) {
      result?.dispose();
      return;
    }
    if (!result) {
      this.callbacks.onSiteStatus?.({ state: "failed", reason: siteFailureReason ?? "no tiles returned" });
      return;
    }

    const group = new THREE.Group();
    group.name = "rz-site";
    group.add(result.mesh);
    this.scene.add(group);
    this.siteGroup = group;
    this.siteResult = result;
    this.siteFarExtentM = result.halfExtentM * Math.SQRT2 * Math.max(0.1, config.siteScale) + 1000;
    this.applySiteTransform();
    this.applySiteMaterial();
    this.applyEnvironmentConfig(this.environmentConfig, false);
    this.applyCameraConfig(this.cameraConfig);
    this.callbacks.onSiteStatus?.({
      state: "ready",
      centreElevationM: result.centreElevationM,
      reliefM: result.reliefM,
    });
  }

  private applySiteTransform() {
    const { siteGroup, siteConfig } = this;
    if (!siteGroup || !siteConfig) return;
    siteGroup.position.set(siteConfig.siteOffsetX, siteConfig.siteElevationOffset, siteConfig.siteOffsetZ);
    siteGroup.rotation.set(0, THREE.MathUtils.degToRad(siteConfig.siteRotationDeg), 0);
    siteGroup.scale.setScalar(siteConfig.siteScale);
  }

  private applySiteMaterial() {
    const { siteResult, siteConfig } = this;
    if (!siteResult || !siteConfig) return;
    const brightness = siteResult.brightnessUniform;
    if (!brightness) return;
    brightness.value = Math.max(0, Math.min(2, siteConfig.siteImageryBrightness));
  }

  private disposeSite() {
    if (this.siteGroup) {
      this.scene?.remove(this.siteGroup);
      this.siteGroup = null;
    }
    this.siteResult?.dispose();
    this.siteResult = null;
  }

  setEnvironmentConfig(config: EnvironmentConfig) {
    if (this.isSunTimeOnlyChange(config)) {
      this.environmentConfig = config;
      this.applySunState(config);
      this.scheduleEnvironmentRebuild(config, false);
      return;
    }
    this.applyEnvironmentConfig(config, false);
  }

  private isSunTimeOnlyChange(next: EnvironmentConfig): boolean {
    if (!this.hasAppliedEnvironmentConfigOnce) return false;
    const prev = this.environmentConfig;
    if (prev === next) return false;
    const keys = Object.keys(next) as (keyof EnvironmentConfig)[];
    if (keys.length !== Object.keys(prev).length) return false;
    let sawSunTimeChange = false;
    for (const key of keys) {
      if (Object.is(prev[key], next[key])) continue;
      if (key !== "viewerTimeHours" && key !== "simulationDate") return false;
      sawSunTimeChange = true;
    }
    return sawSunTimeChange;
  }

  private applySunState(config: EnvironmentConfig) {
    const { sun, ambient, skyMesh, waterMesh } = this;
    if (!sun || !ambient) return;

    const sunPos = this.resolveGlobalSunVector(config);
    const dir = sunDirectionVector(sunPos);
    this.sunDirection.set(dir.x, dir.y, dir.z);

    const distance = this.sunDistance;
    const center = this.contentBounds?.center ?? WORLD_ORIGIN;
    sun.position.set(center.x + dir.x * distance, center.y + Math.max(dir.y, 0.05) * distance, center.z + dir.z * distance);
    sun.target.position.copy(center);

    const isNight = sunPos.elevationDeg <= 0;
    if (config.autoSunColorEnabled) {
      sun.color.setHex(sunColorForElevation(sunPos.elevationDeg));
    } else {
      sun.color.set(config.manualSunColorHex);
    }
    sun.intensity = config.autoSunIntensityEnabled
      ? isNight
        ? 0.1
        : 1.2 + Math.max(0, sunPos.elevationDeg / 90) * 1.8
      : config.manualSunIntensity;
    ambient.intensity = isNight ? 0.08 : 0.15;

    if (skyMesh) skyMesh.sunPosition.value.copy(this.sunDirection);
    if (waterMesh) {
      const reflectSun = config.waterSunReflectionEnabled;
      waterMesh.sunDirection.value.copy(reflectSun ? this.sunDirection : WORLD_UP);
      waterMesh.sunColor.value.setHex(reflectSun ? sunColorForElevation(sunPos.elevationDeg) : 0x000000);
    }
    if (this.groundSunDirectionUniform) this.groundSunDirectionUniform.value.copy(this.sunDirection);
  }

  private applyEnvironmentConfig(config: EnvironmentConfig, immediateRebuild: boolean) {
    this.environmentConfig = config;
    const { scene, skyMesh, waterMesh, groundMesh, cloudSystem } = this;
    if (!this.sun || !this.ambient || !scene) return;

    this.applySunState(config);
    this.hasAppliedEnvironmentConfigOnce = true;

    const isMobileTier = this.isMobileQualityTier();
    const useRealCloudLayer = config.cloudsEnabled && !isMobileTier;

    if (skyMesh) {
      skyMesh.turbidity.value = config.skyTurbidity;
      skyMesh.rayleigh.value = config.skyRayleigh;
      skyMesh.mieCoefficient.value = config.skyMieCoefficient;
      skyMesh.mieDirectionalG.value = config.skyMieDirectionalG;
      skyMesh.showSunDisc.value = config.sunDiscEnabled ? 1 : 0;
      skyMesh.visible = config.skyEnabled;
      const useFallbackClouds = config.cloudsEnabled && !useRealCloudLayer;
      skyMesh.cloudCoverage.value = useFallbackClouds ? config.cloudCoverage : 0;
      skyMesh.cloudDensity.value = useFallbackClouds ? config.cloudDensity : 0;
      skyMesh.cloudElevation.value = config.cloudElevation;
    }
    if (cloudSystem) {
      cloudSystem.mesh.visible = useRealCloudLayer;
    }

    const backdropMesh = this.backdropMesh;
    if (backdropMesh) {
      backdropMesh.rotation.y = THREE.MathUtils.degToRad(config.backdropRotationDeg);
      backdropMesh.rotation.x = THREE.MathUtils.degToRad(config.backdropPitchDeg);
      backdropMesh.position.y = config.backdropElevation;
      backdropMesh.visible = config.backdropEnabled && !!config.backdropImageUrl;
      if (config.backdropImageUrl !== this.backdropImageUrl) {
        this.backdropImageUrl = config.backdropImageUrl;
        const material = backdropMesh.material as THREE.MeshBasicMaterial;
        const previousTexture = material.map;
        if (config.backdropImageUrl) {
          const url = config.backdropImageUrl;
          new THREE.TextureLoader().load(url, (texture) => {
            if (this.backdropImageUrl !== url || !this.backdropMesh) {
              texture.dispose();
              return;
            }
            texture.colorSpace = THREE.SRGBColorSpace;
            material.map = texture;
            material.needsUpdate = true;
            previousTexture?.dispose();
          });
        } else {
          material.map = null;
          material.needsUpdate = true;
          previousTexture?.dispose();
        }
      }
    }

    if (waterMesh) {
      waterMesh.visible = config.waterEnabled;
      waterMesh.position.y = config.waterHeight;
      waterMesh.waterColor.value.set(config.waterColor);
      waterMesh.size.value = config.waterSize;
      const wavesActive = config.waterWavesEnabled && config.waterNormalMapEnabled;
      waterMesh.distortionScale.value = wavesActive ? config.waterDistortionScale : 0;
    }

    if (groundMesh) {
      groundMesh.visible = config.groundEnabled && !this.hasActiveSite();
      const wantsInfinite = config.groundStyle === "infinite";
      const wantedRadius = Math.max(this.boundingRadius * 1.6, 10);
      const currentIsInfinite = groundMesh.userData.isInfinite === true;
      const currentRadius = groundMesh.userData.discRadius as number | undefined;
      if (wantsInfinite !== currentIsInfinite || (!wantsInfinite && currentRadius !== wantedRadius)) {
        const nextGeometry = wantsInfinite
          ? new THREE.PlaneGeometry(GROUND_INFINITE_SIZE, GROUND_INFINITE_SIZE)
          : new THREE.CircleGeometry(wantedRadius, 48);
        groundMesh.geometry.dispose();
        groundMesh.geometry = nextGeometry;
        groundMesh.userData.isInfinite = wantsInfinite;
        groundMesh.userData.discRadius = wantedRadius;
      }
    }
    if (this.groundColorUniform) this.groundColorUniform.value.set(config.groundColor);
    if (this.groundFogColorUniform) this.groundFogColorUniform.value.set(resolveFogColor(config));
    if (this.groundFogRadiusUniform) this.groundFogRadiusUniform.value = Math.max(1, config.groundFogRadius);
    if (this.groundFogStrengthUniform) this.groundFogStrengthUniform.value = config.fogEnabled && config.groundFogEnabled ? 1 : 0;
    if (this.groundCloudShadowStrengthUniform) {
      this.groundCloudShadowStrengthUniform.value = config.cloudsEnabled && config.cloudShadowsEnabled ? 1 : 0;
    }
    if (this.groundCloudHeightUniform) this.groundCloudHeightUniform.value = config.cloudHeight;
    if (this.groundCloudScaleUniform) this.groundCloudScaleUniform.value = Math.max(0.0001, config.cloudScale);
    if (this.groundCloudCoverageUniform) this.groundCloudCoverageUniform.value = config.cloudCoverage;
    if (this.groundCloudWindUniform) this.groundCloudWindUniform.value.copy(this.cloudSystem?.getWindOffset() ?? new THREE.Vector2());

    this.scheduleEnvironmentRebuild(config, immediateRebuild);
  }

  private scheduleEnvironmentRebuild(config: EnvironmentConfig, immediate: boolean) {
    if (this.environmentRebuildTimer != null) {
      clearTimeout(this.environmentRebuildTimer);
      this.environmentRebuildTimer = null;
    }
    const skyEnabledChangedSinceLastRebuild = this.lastRebuiltSkyEnabled !== null && this.lastRebuiltSkyEnabled !== config.skyEnabled;
    if (this.hasRebuiltEnvironmentOnce && !config.environmentRefreshEnabled && !skyEnabledChangedSinceLastRebuild) return;
    if (immediate) {
      this.rebuildEnvironment(config);
      this.hasRebuiltEnvironmentOnce = true;
      return;
    }
    const mountTokenAtStart = this.mountToken;
    this.environmentRebuildTimer = setTimeout(() => {
      this.environmentRebuildTimer = null;
      if (mountTokenAtStart !== this.mountToken) return;
      this.rebuildEnvironment(config);
      this.hasRebuiltEnvironmentOnce = true;
    }, 150);
  }

  private rebuildEnvironment(config: EnvironmentConfig) {
    const scene = this.scene;
    const envScene = this.envScene;
    const pmrem = this.pmrem;
    const skyMesh = this.skyMesh;
    if (!scene || !envScene || !pmrem || !skyMesh) return;
    this.lastRebuiltSkyEnabled = config.skyEnabled;

    if (!config.skyEnabled) {
      skyMesh.visible = false;
      const fallbackColor = new THREE.Color(FOG_SKY_HORIZON_COLOR);
      const prevBackground = envScene.background;
      envScene.background = fallbackColor;
      const renderTarget = pmrem.fromScene(envScene, 0, 0.1, SKY_DOME_SCALE * 1.5, { size: 16 });
      envScene.background = prevBackground;

      this.envRenderTarget?.dispose();
      this.envRenderTarget = renderTarget;
      scene.environment = renderTarget.texture;
      scene.environmentIntensity = config.environmentIntensity;
      scene.background = fallbackColor;
      scene.backgroundIntensity = config.environmentIntensity;
      return;
    }

    skyMesh.visible = true;
    scene.remove(skyMesh);
    envScene.add(skyMesh);
    // The sun disc is far brighter than half-float range; on iPhones it turns the blurred
    // environment into NaN and every lit surface draws black. The sun is its own light.
    const discWas = skyMesh.showSunDisc.value;
    if (isTouchPhoneOrTablet()) skyMesh.showSunDisc.value = 0;
    const renderTarget = pmrem.fromScene(envScene, 0, 0.1, SKY_DOME_SCALE * 1.5, { size: 128 });
    skyMesh.showSunDisc.value = discWas;
    envScene.remove(skyMesh);
    scene.add(skyMesh);

    this.envRenderTarget?.dispose();
    this.envRenderTarget = renderTarget;
    scene.environment = renderTarget.texture;
    scene.environmentIntensity = config.environmentIntensity;
    scene.background = null;
    scene.backgroundIntensity = config.environmentIntensity;
    skyMesh.visible = true;
  }

  setLightingConfig(config: LightingConfig) {
    this.applyLightingConfig(config);
  }

  private applyLightingConfig(config: LightingConfig) {
    this.lightingConfig = config;
    const { renderer, sun, ambient, scene, camera } = this;
    if (!renderer || !sun || !ambient || !scene || !camera) return;

    sun.visible = config.sunLightEnabled;
    renderer.shadowMap.enabled = config.shadowsEnabled;
    sun.castShadow = config.shadowsEnabled && config.sunLightEnabled;
    sun.shadow.radius = config.shadowSoftness;
    setShadowMapTransmitted(renderer, config.transmittedShadowsEnabled);

    const wantsCSM = config.shadowsEnabled && config.sunLightEnabled && config.csmEnabled;
    const needsCSMRebuild = wantsCSM !== (this.csmSystem != null) || (wantsCSM && this.csmSystem != null && this.csmSystem.node.cascades !== config.csmCascades);
    if (needsCSMRebuild) {
      this.csmSystem?.dispose();
      this.csmSystem = wantsCSM ? buildCSMSystem(sun, config) : null;
    } else {
      this.csmSystem?.updateFrustums();
    }

    this.applyScenePostPipeline();

    void this.artificialLightSystem?.sync(config.artificialLights);

    for (const root of this.modelRootsBySlot.values()) {
      applyTransmittedShadows(root, config);
    }
  }

  setRenderingConfig(config: RenderingConfig) {
    const antialiasChanged = config.antialiasEnabled !== this.renderingConfig.antialiasEnabled;
    this.renderingConfig = config;
    if (antialiasChanged && this.renderer) {
      void this.remount();
      return;
    }
    this.applyRenderingConfig(config);
  }

  private applyRenderingConfig(config: RenderingConfig) {
    this.renderingConfig = config;
    const { renderer } = this;
    if (!renderer) return;

    renderer.toneMapping = TONE_MAPPING_MAP[config.toneMapping];
    renderer.toneMappingExposure = config.exposure;

    if (config.lutEnabled) {
      ensureLutLoading(config.lutPreset, () => {
        if (this.renderingConfig === config) this.applyScenePostPipeline();
      });
    }

    this.applyScenePostPipeline();
  }

  private applyScenePostPipeline() {
    const { renderer, scene, camera, sun } = this;
    if (!renderer || !scene || !camera || !sun) return;
    const signature = computeScenePostSignature(this.lightingConfig, this.renderingConfig);
    if (signature !== this.scenePostSignature) {
      this.scenePostPipeline?.dispose();
      this.scenePostPipeline = buildScenePostPipeline(renderer, scene, camera, sun, this.lightingConfig, this.renderingConfig);
      this.scenePostSignature = signature;
    } else {
      this.scenePostPipeline?.update(this.lightingConfig, this.renderingConfig);
    }
  }

  setQualityConfig(config: QualityConfig) {
    const renderingModeChanged = config.renderingMode !== this.qualityConfig.renderingMode;
    this.qualityConfig = config;
    if (renderingModeChanged) {
      void this.remount();
      return;
    }
    const target = resolveQualityTarget(config);
    this.effectiveRenderScale = target.renderScale;
    this.downgradeStep = 0;
    if (this.renderer) this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, target.dprCap));
    if (this.sun) applySunShadowMapSize(this.sun, target.shadowMapSize);
    this.applyRenderScale();
  }

  private async remount() {
    const container = this.container;
    if (!container) return;
    const showPerfStats = this.showPerfStats;
    const qualityConfig = this.qualityConfig;
    const entries = this.lastSyncEntries;
    this.dispose();
    await this.mount(container, { showPerfStats, qualityConfig });
    await this.syncModels(entries);
  }

  private applyRenderScale() {
    const { renderer, container } = this;
    if (!renderer || !container || !container.clientWidth || !container.clientHeight) return;
    const scale = this.interactionRenderScale != null ? Math.min(this.interactionRenderScale, this.effectiveRenderScale) : this.effectiveRenderScale;
    renderer.setSize(container.clientWidth * scale, container.clientHeight * scale, false);
  }

  private sampleAdaptiveQuality() {
    if (!this.qualityConfig.adaptiveQualityEnabled || !this.qualityConfig.runtimeQualityReductionEnabled) return;
    if (this.isMobileViewport) return;
    if (this.isInteracting) return;
    const frames = this.frameTimes;
    if (frames.length < 60 || this.downgradeStep >= 3) return;
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    if (avg <= 33) return;
    this.effectiveRenderScale = Math.max(0.4, this.effectiveRenderScale * 0.85);
    this.downgradeStep += 1;
    this.frameTimes = [];
    this.applyRenderScale();
  }

  getCameraState(): { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; fov: number } | null {
    const { camera, controls } = this;
    if (!camera || !controls) return null;
    return {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
      fov: camera.fov,
    };
  }

  flyToPreset(preset: CameraPreset) {
    const { camera, controls } = this;
    if (!camera || !controls) return;
    this.idleDrone.notifyInteraction(performance.now());
    this.cameraTransition = {
      startPos: camera.position.clone(),
      endPos: new THREE.Vector3(preset.position.x, preset.position.y, preset.position.z),
      startTarget: controls.target.clone(),
      endTarget: new THREE.Vector3(preset.target.x, preset.target.y, preset.target.z),
      startFov: camera.fov,
      endFov: preset.fov,
      startTime: performance.now(),
      durationMs: Math.max(1, preset.durationMs),
    };
  }

  showCameraHelperFor(preset: CameraPreset | null) {
    const scene = this.scene;
    if (!scene) return;
    if (this.cameraHelper) {
      scene.remove(this.cameraHelper);
      this.cameraHelper.dispose();
      this.cameraHelper = null;
    }
    if (!preset || !this.cameraConfig) return;
    const previewCam = new THREE.PerspectiveCamera(preset.fov, 16 / 9, this.cameraConfig.cameraNearClip, Math.min(this.boundingRadius * 2, 200));
    previewCam.position.set(preset.position.x, preset.position.y, preset.position.z);
    previewCam.lookAt(preset.target.x, preset.target.y, preset.target.z);
    previewCam.updateProjectionMatrix();
    const helper = new THREE.CameraHelper(previewCam);
    scene.add(helper);
    this.cameraHelper = helper;
  }

  resetIdleTimer() {
    this.idleDrone.notifyInteraction(performance.now());
  }

  cancelIdleDrone() {
    this.idleDrone.notifyInteraction(performance.now());
  }

  isIdleDroneActive(): boolean {
    return this.idleDrone.isActive();
  }

  setIdleDroneSuspended(suspended: boolean) {
    this.idleDrone.setSuspended(suspended);
  }

  startIdleDronePreview() {
    this.idleDrone.startPreview();
  }

  stopIdleDronePreview() {
    this.idleDrone.stopPreview();
  }

  setShowDronePath(enabled: boolean) {
    this.showDronePath = enabled;
    if (enabled) this.rebuildDronePathHelper();
    else this.clearDronePathHelper();
  }

  private clearDronePathHelper() {
    const group = this.dronePathHelperGroup;
    if (!group) return;
    for (const line of this.droneRingLines) {
      group.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.droneRingLines = [];
    if (this.droneMarker) {
      group.remove(this.droneMarker);
      this.droneMarker.geometry.dispose();
      (this.droneMarker.material as THREE.Material).dispose();
      this.droneMarker = null;
    }
  }

  private rebuildDronePathHelper() {
    const group = this.dronePathHelperGroup;
    if (!group) return;
    this.clearDronePathHelper();
    const points = this.idleDrone.getPathPoints();
    if (!points) return;
    const ringColors: Record<"high" | "mid" | "low", number> = { high: 0x60a5fa, mid: 0x818cf8, low: 0xf472b6 };
    (["high", "mid", "low"] as const).forEach((key) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points[key]);
      const material = new THREE.LineBasicMaterial({ color: ringColors[key], transparent: true, opacity: 0.6 });
      const line = new THREE.Line(geometry, material);
      group.add(line);
      this.droneRingLines.push(line);
    });
    const markerGeometry = new THREE.SphereGeometry(Math.max(0.3, this.boundingRadius * 0.03), 12, 12);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    group.add(marker);
    this.droneMarker = marker;
  }

  private updateDronePathHelper() {
    const marker = this.droneMarker;
    const camera = this.camera;
    if (!marker || !camera) return;
    marker.visible = this.idleDrone.isActive();
    marker.position.copy(camera.position);
  }

  async captureScreenshot(): Promise<string | null> {
    if (!this.renderer || !this.scene || !this.camera) return null;
    this.renderer.render(this.scene, this.camera);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    try {
      return this.renderer.domElement.toDataURL("image/png");
    } catch {
      return null;
    }
  }

  dispose() {
    this.mountToken++;
    this.syncToken++;
    this.siteToken++;
    this.siteAbort?.abort();
    this.siteAbort = null;
    this.siteSignature = null;
    this.disposeSite();
    const renderer = this.renderer;
    if (renderer) renderer.setAnimationLoop(null);
    if (this.basemapRafId != null) {
      cancelAnimationFrame(this.basemapRafId);
      this.basemapRafId = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeTimer != null) clearTimeout(this.resizeTimer);
    this.resizeTimer = null;
    this.controls?.dispose();
    this.controls = null;
    this.dracoLoader?.dispose();
    this.dracoLoader = null;
    this.loader = null;
    this.loadedRoots = [];
    this.modelRootsBySlot.clear();
    this.loadedGlbUrlBySlot.clear();
    if (renderer) {
      renderer.dispose();
      if (!this.map) renderer.domElement.remove();
    }
    this.map?.remove();
    this.map = null;
    this.basemapLayer = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.sun = null;
    this.ambient = null;
    this.container = null;
    this.frameTimes = [];
    this.lastFrameAt = null;
    this.perfSampleCounter = 0;
    this.cameraHelper?.dispose();
    this.cameraHelper = null;
    this.cameraTransition = null;
    this.hasFramedOnce = false;

    if (this.visibilityHandler) document.removeEventListener("visibilitychange", this.visibilityHandler);
    this.visibilityHandler = null;
    this.clearDronePathHelper();
    this.dronePathHelperGroup = null;
    this.showDronePath = false;
    this.idleDrone.reset();
    this.contentBounds = null;
    this.clippingGroup = null;
    this.unclippedModelGroup = null;
    this.sectionHelperGroup = null;
    this.activeSectionId = null;
    this.sectionFillClippingGroup = null;
    this.activeSectionPlanes = null;
    this.sectionFillMaterial?.dispose();
    this.sectionFillMaterial = null;
    this.sectionIndicatorMaterial?.dispose();
    this.sectionIndicatorMaterial = null;
    this.sectionIndicatorMesh = null;
    this.sectionFillMeshes = [];

    disposeUnitBoxAppearanceCaches(this.unitMaterialCache, this.unitOutlineByMesh);
    this.unitSelectionScaleOriginals.clear();
    this.unitRegistry.clear();
    this.unitRaycastTargets = [];
    this.selectedUnitId = null;
    this.hoveredUnitId = null;
    this.isolatedUnitId = null;
    this.unitIdFilter = null;

    if (this.environmentRebuildTimer != null) clearTimeout(this.environmentRebuildTimer);
    this.environmentRebuildTimer = null;
    this.hasRebuiltEnvironmentOnce = false;
    this.lastRebuiltSkyEnabled = null;
    this.envRenderTarget?.dispose();
    this.envRenderTarget = null;
    this.pmrem?.dispose();
    this.pmrem = null;
    this.envScene = null;
    this.skyMesh?.geometry.dispose();
    (this.skyMesh?.material as THREE.Material | undefined)?.dispose();
    this.skyMesh = null;
    this.backdropMesh?.geometry.dispose();
    ((this.backdropMesh?.material as THREE.MeshBasicMaterial | undefined)?.map)?.dispose();
    (this.backdropMesh?.material as THREE.Material | undefined)?.dispose();
    this.backdropMesh = null;
    this.backdropImageUrl = null;
    this.waterMesh?.geometry.dispose();
    (this.waterMesh?.material as THREE.Material | undefined)?.dispose();
    this.waterMesh = null;
    this.groundMesh?.geometry.dispose();
    (this.groundMesh?.material as THREE.Material | undefined)?.dispose();
    this.groundMesh = null;
    this.groundColorUniform = null;
    this.groundFogColorUniform = null;
    this.groundFogRadiusUniform = null;
    this.groundFogStrengthUniform = null;
    this.groundCloudShadowStrengthUniform = null;
    this.groundCloudHeightUniform = null;
    this.groundCloudScaleUniform = null;
    this.groundCloudCoverageUniform = null;
    this.groundCloudWindUniform = null;
    this.groundSunDirectionUniform = null;
    this.cloudSystem?.dispose();
    this.cloudSystem = null;
    this.fogSystem = null;
    this.sunDistance = 200;

    this.csmSystem?.dispose();
    this.csmSystem = null;
    this.scenePostPipeline?.dispose();
    this.scenePostPipeline = null;
    this.scenePostSignature = null;
    this.artificialLightSystem?.dispose();
    this.artificialLightSystem = null;
  }
}
