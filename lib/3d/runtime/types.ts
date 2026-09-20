/** Browser-safe types adapted from the Rozaris 3D runtime. */

export type Unit = {
  id: string;
  code: string;
  status: "available" | "reserved" | "sold";
};

export type RenderingMode = "auto" | "webgpu" | "webgl2";
export type ToneMapping = "none" | "linear" | "reinhard" | "cineon" | "aces" | "agx" | "neutral";
export type QualityPreset = "ultra_desktop" | "high_desktop" | "balanced" | "mobile_high" | "mobile_low" | "custom";
export type GlassPreset = "performance" | "standard" | "premium";
export type MaterialPresetId =
  | "concrete"
  | "plaster"
  | "stone"
  | "wood"
  | "aluminium"
  | "steel"
  | "chrome"
  | "ceramic";

export interface SolarAnchor {
  id: string;
  timeHours: number;
  elevationDeg: number;
  azimuthDeg: number;
}

export interface Project3DConfig {
  groundEnabled: boolean;
  groundStyle: "disc" | "infinite";
  groundColor: string;
  groundFogEnabled: boolean;
  groundFogRadius: number;
  cameraStartDistanceMultiplier: number;
  cameraMinDistanceMultiplier: number;
  cameraMaxDistanceMultiplier: number;
  cameraMaxPolarDeg: number;
  cameraMinPolarDeg: number;
  autoRotate: boolean;
  idleDroneEnabled: boolean;
  idleDroneDelaySec: number;
  idleDroneOrbitDurationSec: number;
  idleDroneClockwise: boolean;
  idleDroneMotionEnabled: boolean;
  idleDroneHeightEnabled: boolean;
  idleDroneHeightAmplitude: number;
  idleDroneDistanceEnabled: boolean;
  idleDroneDistanceAmplitude: number;
  idleDroneTargetEnabled: boolean;
  idleDroneTargetAmplitude: number;
  idleDroneVerticalCycles: number;
  idleDronePhaseOffsetDeg: number;
  idleDroneSmoothness: number;
  status: "draft" | "published";

  renderingMode: RenderingMode;
  qualityPreset: QualityPreset;
  customRenderScale: number | null;
  customDprCap: number | null;
  adaptiveQualityEnabled: boolean;
  runtimeQualityReductionEnabled: boolean;
  interactionQualityReductionEnabled: boolean;
  deviceDetectionEnabled: boolean;
  glassPreset: GlassPreset;
  environmentIntensity: number;
  cameraFovDesktop: number;
  cameraFovMobile: number;
  cameraNearClip: number;
  cameraFarClip: number;
  cameraMinAzimuthDeg: number | null;
  cameraMaxAzimuthDeg: number | null;
  cameraOrbitEnabled: boolean;
  cameraPanEnabled: boolean;
  cameraZoomEnabled: boolean;
  cameraDampingEnabled: boolean;
  cameraAutoFocusEnabled: boolean;
  cameraHelperEnabled: boolean;
  cameraSensorWidthMm: number;

  cameraPresets: CameraPreset[];
  exposure: number;
  toneMapping: ToneMapping;

  viewerUI: ViewerUIToggles;

  sunAzimuthDeg: number;
  sunElevationDeg: number;

  solarControllerEnabled: boolean;
  solarPathMode: "manual" | "geographic";
  viewerTimeControlEnabled: boolean;
  viewerTimeHours: number;
  viewerTimeStartHours: number;
  viewerTimeEndHours: number;
  viewerTimeStepMinutes: number;
  solarAnchors: SolarAnchor[];
  geoLatitude: number;
  geoLongitude: number;
  simulationDate: string;
  northOffsetDeg: number;
  sunDiscEnabled: boolean;
  autoSunIntensityEnabled: boolean;
  autoSunColorEnabled: boolean;
  manualSunIntensity: number;
  manualSunColorHex: string;
  environmentRefreshEnabled: boolean;

  skyEnabled: boolean;
  skyTurbidity: number;
  skyRayleigh: number;
  skyMieCoefficient: number;
  skyMieDirectionalG: number;

  mapViewEnabled: boolean;
  mapViewLatitude: number | null;
  mapViewLongitude: number | null;
  mapViewAltitude: number;
  mapViewHeadingDeg: number;
  mapViewScale: number;
  mapViewZoom: number;
  mapViewPitchDeg: number;
  mapViewBearingDeg: number;

  siteEnabled: boolean;
  siteRadiusM: number;
  siteTerrainEnabled: boolean;
  siteImageryEnabled: boolean;
  siteImageryBrightness: number;
  siteOffsetX: number;
  siteOffsetZ: number;
  siteElevationOffset: number;
  siteRotationDeg: number;
  siteScale: number;

  backdropEnabled: boolean;
  backdropImageUrl: string | null;
  backdropRotationDeg: number;
  backdropPitchDeg: number;
  backdropElevation: number;

  fogEnabled: boolean;
  fogColor: string;
  fogDensity: number;
  fogMatchesSky: boolean;
  fogHeightBandEnabled: boolean;
  fogHazeEnabled: boolean;
  fogNoiseEnabled: boolean;
  fogMovementEnabled: boolean;
  fogSunInteractionEnabled: boolean;
  fogBaseHeight: number;
  fogTopHeight: number;
  fogHaze: number;
  fogNoiseStrength: number;
  fogNoiseScale: number;
  fogWindDirectionDeg: number;
  fogWindSpeed: number;
  fogFalloff: number;
  fogMaxOpacity: number;
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;

  waterEnabled: boolean;
  waterDistortionScale: number;
  waterSize: number;
  waterType: "sea" | "lake" | "pool" | "decorative";
  waterWavesEnabled: boolean;
  waterMovementEnabled: boolean;
  waterSunReflectionEnabled: boolean;
  waterEnvReflectionEnabled: boolean;
  waterNormalMapEnabled: boolean;
  waterHeight: number;
  waterColor: string;
  waterDeepColor: string;

  cloudsEnabled: boolean;
  cloudCoverage: number;
  cloudDensity: number;
  cloudElevation: number;
  cloudMovementEnabled: boolean;
  cloudSunLightingEnabled: boolean;
  cloudShadowsEnabled: boolean;
  cloudHeight: number;
  cloudThickness: number;
  cloudThreshold: number;
  cloudOpacity: number;
  cloudSoftness: number;
  cloudScale: number;
  cloudWindSpeed: number;
  cloudWindDirectionDeg: number;
  cloudRaymarchSteps: number;

  shadowSoftness: number;

  lutEnabled: boolean;
  lutPreset: string;
  lutIntensity: number;

  depthOfFieldEnabled: boolean;
  depthOfFieldFocalLength: number;
  depthOfFieldBokehScale: number;

  distanceBlurEnabled: boolean;
  distanceBlurStartM: number;
  distanceBlurFullM: number;
  distanceBlurAmount: number;
  distanceBlurRadius: number;

  logarithmicDepthEnabled: boolean;

  loadingRevealEnabled: boolean;

  unitColorAvailable: string;
  unitColorReserved: string;
  unitColorSold: string;
  unitColorSelected: string;

  unitBlocksEnabled: boolean;
  unitBlocksStatusColorsEnabled: boolean;
  unitBlocksXrayEnabled: boolean;
  unitBlocksDefaultOpacity: number;
  unitBlocksHoverOpacity: number;
  unitBlocksSelectedOpacity: number;
  unitBlocksSelectedOutlineEnabled: boolean;
  unitBlocksSelectedOutlineWidth: number;
  unitBlocksSelectedScaleEnabled: boolean;
  unitBlocksSelectedScale: number;
  unitBlocksSelectedFillEnabled: boolean;
  unitColorSelectedFill: string;
  unitBlocksSelectedXrayEnabled: boolean;

  unitPoiCameraEnabled: boolean;
  unitPoiCameraFov: number;
  unitPoiCameraDistanceMultiplier: number;
  unitPoiCameraHeightOffset: number;
  unitPoiTransitionMs: number;
  unitPoiAutoOcclusionCorrection: boolean;

  causticsEnabled: boolean;
  causticsScale: number;
  causticsSpeed: number;
  causticsIntensityAvailable: number;
  causticsIntensityReserved: number;
  causticsIntensitySold: number;

  shadowsEnabled: boolean;
  antialiasEnabled: boolean;

  sections: Section[];

  sunLightEnabled: boolean;
  sunTemperatureK: number;
  csmEnabled: boolean;
  csmCascades: number;
  csmMaxDistance: number;
  csmResolution: number;
  csmSplitMode: "practical" | "uniform" | "logarithmic";
  csmMargin: number;
  softShadowsEnabled: boolean;
  contactShadowsEnabled: boolean;
  contactShadowBlur: number;
  contactShadowDarkness: number;
  contactShadowOpacity: number;
  contactShadowRange: number;
  transmittedShadowsEnabled: boolean;
  coloredShadowsEnabled: boolean;
  transmittedShadowStrength: number;
  giEnabled: boolean;
  giIndirectEnabled: boolean;
  giAOEnabled: boolean;
  giBackfaceLighting: boolean;
  giTemporalFiltering: boolean;
  giScreenSpaceSampling: boolean;
  giIntensity: number;
  giAOIntensity: number;
  giRadius: number;
  giSliceCount: number;
  giStepCount: number;
  giExpFactor: number;
  giThickness: number;
  giLinearThickness: boolean;
  artificialLights: ArtificialLight[];
  volumetricLightingEnabled: boolean;
  sunShaftsEnabled: boolean;
  lightVolumesEnabled: boolean;
  volumetricRaymarchSteps: number;
  volumetricDensity: number;
  volumetricMaxDensity: number;
  volumetricDistanceAtten: number;

  ssrEnabled: boolean;
  ssrIntensity: number;
  ssrMaxDistance: number;
  ssrThickness: number;
  ssrQuality: number;
  lensFlareEnabled: boolean;
  lensFlareIntensity: number;
  motionBlurEnabled: boolean;
  motionBlurIntensity: number;

  updatedAt: string;
}

export interface ArtificialLight {
  id: string;
  name: string;
  type: "point" | "spot" | "ies" | "rect";
  enabled: boolean;
  shadowsEnabled: boolean;
  volumetricEnabled: boolean;
  helperEnabled: boolean;
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  colorHex: string;
  temperatureK: number | null;
  intensity: number;
  distance: number;
  decay: number;
  angleDeg: number;
  penumbra: number;
  width: number;
  height: number;
  iesProfileUrl: string | null;
}

export type LightingConfig = Pick<
  Project3DConfig,
  | "sunLightEnabled"
  | "sunTemperatureK"
  | "autoSunIntensityEnabled"
  | "autoSunColorEnabled"
  | "manualSunIntensity"
  | "manualSunColorHex"
  | "csmEnabled"
  | "csmCascades"
  | "csmMaxDistance"
  | "csmResolution"
  | "csmSplitMode"
  | "csmMargin"
  | "softShadowsEnabled"
  | "shadowSoftness"
  | "shadowsEnabled"
  | "contactShadowsEnabled"
  | "contactShadowBlur"
  | "contactShadowDarkness"
  | "contactShadowOpacity"
  | "contactShadowRange"
  | "transmittedShadowsEnabled"
  | "coloredShadowsEnabled"
  | "transmittedShadowStrength"
  | "giEnabled"
  | "giIndirectEnabled"
  | "giAOEnabled"
  | "giBackfaceLighting"
  | "giTemporalFiltering"
  | "giScreenSpaceSampling"
  | "giIntensity"
  | "giAOIntensity"
  | "giRadius"
  | "giSliceCount"
  | "giStepCount"
  | "giExpFactor"
  | "giThickness"
  | "giLinearThickness"
  | "artificialLights"
  | "volumetricLightingEnabled"
  | "sunShaftsEnabled"
  | "lightVolumesEnabled"
  | "volumetricRaymarchSteps"
  | "volumetricDensity"
  | "volumetricMaxDensity"
  | "volumetricDistanceAtten"
>;

export type RenderingConfig = Pick<
  Project3DConfig,
  | "ssrEnabled"
  | "ssrIntensity"
  | "ssrMaxDistance"
  | "ssrThickness"
  | "ssrQuality"
  | "antialiasEnabled"
  | "bloomEnabled"
  | "bloomStrength"
  | "bloomRadius"
  | "lensFlareEnabled"
  | "lensFlareIntensity"
  | "depthOfFieldEnabled"
  | "depthOfFieldFocalLength"
  | "depthOfFieldBokehScale"
  | "distanceBlurEnabled"
  | "distanceBlurStartM"
  | "distanceBlurFullM"
  | "distanceBlurAmount"
  | "distanceBlurRadius"
  | "cameraAutoFocusEnabled"
  | "motionBlurEnabled"
  | "motionBlurIntensity"
  | "exposure"
  | "toneMapping"
  | "lutEnabled"
  | "lutPreset"
  | "lutIntensity"
>;

export type UnitsConfig = Pick<
  Project3DConfig,
  | "unitColorAvailable"
  | "unitColorReserved"
  | "unitColorSold"
  | "unitColorSelected"
  | "unitBlocksEnabled"
  | "unitBlocksStatusColorsEnabled"
  | "unitBlocksXrayEnabled"
  | "unitBlocksDefaultOpacity"
  | "unitBlocksHoverOpacity"
  | "unitBlocksSelectedOpacity"
  | "unitBlocksSelectedOutlineEnabled"
  | "unitBlocksSelectedOutlineWidth"
  | "unitBlocksSelectedScaleEnabled"
  | "unitBlocksSelectedScale"
  | "unitBlocksSelectedFillEnabled"
  | "unitColorSelectedFill"
  | "unitBlocksSelectedXrayEnabled"
  | "unitPoiCameraEnabled"
  | "unitPoiCameraFov"
  | "unitPoiCameraDistanceMultiplier"
  | "unitPoiCameraHeightOffset"
  | "unitPoiTransitionMs"
  | "unitPoiAutoOcclusionCorrection"
>;

export type EnvironmentConfig = Pick<
  Project3DConfig,
  | "solarControllerEnabled"
  | "solarPathMode"
  | "viewerTimeHours"
  | "solarAnchors"
  | "geoLatitude"
  | "geoLongitude"
  | "simulationDate"
  | "northOffsetDeg"
  | "siteRotationDeg"
  | "sunDiscEnabled"
  | "autoSunIntensityEnabled"
  | "autoSunColorEnabled"
  | "manualSunIntensity"
  | "manualSunColorHex"
  | "environmentRefreshEnabled"
  | "sunAzimuthDeg"
  | "sunElevationDeg"
  | "skyEnabled"
  | "skyTurbidity"
  | "skyRayleigh"
  | "skyMieCoefficient"
  | "skyMieDirectionalG"
  | "backdropEnabled"
  | "backdropImageUrl"
  | "backdropRotationDeg"
  | "backdropPitchDeg"
  | "backdropElevation"
  | "environmentIntensity"
  | "cloudsEnabled"
  | "cloudCoverage"
  | "cloudDensity"
  | "cloudElevation"
  | "cloudMovementEnabled"
  | "cloudSunLightingEnabled"
  | "cloudShadowsEnabled"
  | "cloudHeight"
  | "cloudThickness"
  | "cloudThreshold"
  | "cloudOpacity"
  | "cloudSoftness"
  | "cloudScale"
  | "cloudWindSpeed"
  | "cloudWindDirectionDeg"
  | "cloudRaymarchSteps"
  | "fogEnabled"
  | "fogColor"
  | "fogDensity"
  | "fogMatchesSky"
  | "fogHeightBandEnabled"
  | "fogHazeEnabled"
  | "fogNoiseEnabled"
  | "fogMovementEnabled"
  | "fogSunInteractionEnabled"
  | "fogBaseHeight"
  | "fogTopHeight"
  | "fogHaze"
  | "fogNoiseStrength"
  | "fogNoiseScale"
  | "fogWindDirectionDeg"
  | "fogWindSpeed"
  | "fogFalloff"
  | "fogMaxOpacity"
  | "waterEnabled"
  | "waterDistortionScale"
  | "waterSize"
  | "waterType"
  | "waterWavesEnabled"
  | "waterMovementEnabled"
  | "waterSunReflectionEnabled"
  | "waterEnvReflectionEnabled"
  | "waterNormalMapEnabled"
  | "waterHeight"
  | "waterColor"
  | "waterDeepColor"
  | "groundEnabled"
  | "groundStyle"
  | "groundColor"
  | "groundFogEnabled"
  | "groundFogRadius"
>;

export type SiteConfig = Pick<
  Project3DConfig,
  | "siteEnabled"
  | "siteRadiusM"
  | "siteTerrainEnabled"
  | "siteImageryEnabled"
  | "siteImageryBrightness"
  | "siteOffsetX"
  | "siteOffsetZ"
  | "siteElevationOffset"
  | "siteRotationDeg"
  | "siteScale"
>;

export interface SiteRuntimeConfig extends SiteConfig {
  latitude: number | null;
  longitude: number | null;
}

export interface ViewerUIToggles {
  home: boolean;
  unitSearch: boolean;
  hoverEnabled?: boolean;
  selectEnabled?: boolean;
  showUnitInfo?: boolean;
  sectionsEnabled?: boolean;
  sunPresetEnabled?: boolean;

  unitInteractionEnabled?: boolean;
  highlightEnabled?: boolean;
  statusColorsEnabled?: boolean;
  isolationEnabled?: boolean;
  floorIsolationEnabled?: boolean;
  unitPageLinkEnabled?: boolean;
  filtersEnabled?: boolean;
  filterFloorEnabled?: boolean;
  filterAvailabilityEnabled?: boolean;
  filterBedroomsEnabled?: boolean;
  filterTypeEnabled?: boolean;
  filterPriceEnabled?: boolean;
  resetEnabled?: boolean;
  fullscreenEnabled?: boolean;
  shotsMenuEnabled?: boolean;
  screenshotEnabled?: boolean;
  shareEnabled?: boolean;
}

export interface CameraPreset {
  id: string;
  label: string;
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov: number;
  durationMs: number;
}

export interface Section {
  id: string;
  name: string;
  scope: "project" | "building";
  buildingName?: string;
  centerX: number;
  centerZ: number;
  widthM: number;
  depthM: number;
  rotationDeg: number;
  heightM: number;
  bottomEnabled: boolean;
  heightOnly?: boolean;
  fillGapsEnabled: boolean;
  fillColor: string;
  cameraPreset?: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; fov: number };
  floorId?: string;
  hidden?: boolean;
}

export interface ProjectMapModel {
  glbUrl: string;
  fileName: string;
  fileSize: number;
  scale: number;
  rotationDeg: number;
  altitudeOffset: number;
  enabled: boolean;
  hideBaseBuilding: boolean;
  hiddenBuildingLng?: number | null;
  hiddenBuildingLat?: number | null;
  updatedAt: string;
}

export interface UnitMeshLink {
  meshName: string;
  unitId: string;
  poiYawDeg?: number;
  poiEnabled?: boolean;
  poiDistanceOverride?: number | null;
  poiHeightOverride?: number | null;
}

export interface SceneManifestNode {
  nodeId: string;
  name: string;
  meshIndex: number | null;
  parentNodeId: string | null;
  depth: number;
  isMesh: boolean;
  autoClassification: "unit_block" | "architecture";
}

export type NodeClassification = "architecture" | "landscape" | "interaction" | "helper";

export interface NodeOverride {
  nodeId: string;
  classification?: NodeClassification;
  materialPreset?: MaterialPresetId;
  colorHex?: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  iridescence?: number;
  iridescenceIOR?: number;
  visible?: boolean;
  carried?: boolean;

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
}

export type DetailModelSlotRole = "building" | "units" | "surroundings" | "context" | "custom";

export interface DetailModelSlot {
  id: string;
  projectId: string;
  name: string;
  order: number;
  role: DetailModelSlotRole;
  transformParentSlotId: string | null;
  createdAt: string;
}

export interface ProjectDetailModel {
  glbUrl: string;
  fileName: string;
  fileSize: number;
  scale: number;
  rotationDeg: number;
  altitudeOffset: number;
  positionX: number;
  positionZ: number;
  rotationXDeg: number;
  rotationZDeg: number;
  enabled: boolean;
  visible: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  selectable: boolean;
  transformLocked: boolean;
  updatedAt: string;
  unitLinks: UnitMeshLink[];
  sceneManifest: SceneManifestNode[];
  nodeOverrides: NodeOverride[];
  triangleCount: number | null;
  meshCount: number | null;
  materialCount: number | null;
  textureCount: number | null;
}

export interface ExperienceDocument {
  schemaVersion: 1;
  projectId: string;
  slotId: string;
  slotName: string;
  revision: number;
  model: {
    scale: number;
    rotationDeg: number;
    altitudeOffset: number;
  };
  materials: {
    overrides: NodeOverride[];
  };
  environment: {
    environmentIntensity: number;
  };
  lighting: {
    sunAzimuthDeg: number;
    sunElevationDeg: number;
  };
  camera: {
    presets: CameraPreset[];
    fovDesktop: number;
    fovMobile: number;
    startDistanceMultiplier: number;
    minDistanceMultiplier: number;
    maxDistanceMultiplier: number;
    maxPolarDeg: number;
    autoRotate: boolean;
    idleDrone: {
      enabled: boolean;
      delaySec: number;
      orbitDurationSec: number;
      clockwise: boolean;
      motionEnabled: boolean;
      height: { enabled: boolean; amplitude: number };
      distance: { enabled: boolean; amplitude: number };
      target: { enabled: boolean; amplitude: number };
      verticalCycles: number;
      phaseOffsetDeg: number;
      smoothness: number;
    };
  };
  effects: {
    qualityPreset: QualityPreset;
    renderingMode: RenderingMode;
    glassPreset: GlassPreset;
    exposure: number;
    toneMapping: ToneMapping;
  };
  units: {
    bindings: UnitMeshLink[];
  };
  sections: Section[];
  viewer: ViewerUIToggles;
  publishing: {
    publicationStatus: "draft" | "published" | "archived";
    validationStatus: "ready" | "warning" | "blocked";
  };
}

