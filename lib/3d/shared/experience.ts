import type { Project3DConfig } from "@/lib/3d/runtime/types";

import { PROJECT_3D_SCHEMA_VERSION } from "./contracts";
import { environmentRefFile } from "./environment-refs";

export type Project3DExperienceDocument = {
  schemaVersion: typeof PROJECT_3D_SCHEMA_VERSION;
  revision: number;
  config: Project3DConfig;
};

/** Behavioral defaults carried from the active Rozaris Experience Editor. */
export const DEFAULT_PROJECT_3D_CONFIG: Project3DConfig = {
  groundEnabled: true, groundStyle: "disc", groundColor: "#d8d6e6", groundFogEnabled: false, groundFogRadius: 300,
  cameraStartDistanceMultiplier: 1, cameraMinDistanceMultiplier: 0.4, cameraMaxDistanceMultiplier: 2.5,
  cameraMaxPolarDeg: 85, cameraMinPolarDeg: 0, autoRotate: true,
  idleDroneEnabled: true, idleDroneDelaySec: 60, idleDroneOrbitDurationSec: 80, idleDroneClockwise: true,
  idleDroneMotionEnabled: true, idleDroneHeightEnabled: true, idleDroneHeightAmplitude: 0.18,
  idleDroneDistanceEnabled: true, idleDroneDistanceAmplitude: 0.05, idleDroneTargetEnabled: true,
  idleDroneTargetAmplitude: 0.06, idleDroneVerticalCycles: 2, idleDronePhaseOffsetDeg: 0, idleDroneSmoothness: 0.88,
  status: "draft", renderingMode: "auto", qualityPreset: "high_desktop", customRenderScale: null, customDprCap: null,
  adaptiveQualityEnabled: true, runtimeQualityReductionEnabled: true, interactionQualityReductionEnabled: true,
  deviceDetectionEnabled: true, glassPreset: "standard", environmentIntensity: 0.25,
  cameraFovDesktop: 38, cameraFovMobile: 48, cameraNearClip: 0.1, cameraFarClip: 2000,
  cameraMinAzimuthDeg: null, cameraMaxAzimuthDeg: null, cameraOrbitEnabled: true, cameraPanEnabled: true,
  cameraZoomEnabled: true, cameraDampingEnabled: true, cameraAutoFocusEnabled: true, cameraHelperEnabled: false,
  cameraSensorWidthMm: 36, cameraPresets: [], exposure: 1, toneMapping: "aces",
  viewerUI: { home: true, unitSearch: true, hoverEnabled: true, selectEnabled: true, showUnitInfo: true, sectionsEnabled: true, fullscreenEnabled: true, shotsMenuEnabled: true },
  sunAzimuthDeg: 180, sunElevationDeg: 45, solarControllerEnabled: false, solarPathMode: "manual",
  viewerTimeControlEnabled: false, viewerTimeHours: 12, viewerTimeStartHours: 6, viewerTimeEndHours: 20,
  viewerTimeStepMinutes: 15, solarAnchors: [], geoLatitude: 41.3275, geoLongitude: 19.8187,
  simulationDate: "2025-01-01T00:00:00.000Z", northOffsetDeg: 0, sunDiscEnabled: true,
  autoSunIntensityEnabled: true, autoSunColorEnabled: true, manualSunIntensity: 1.2, manualSunColorHex: "#ffffff",
  environmentRefreshEnabled: true, skyEnabled: true, skyTurbidity: 4, skyRayleigh: 2.4,
  skyMieCoefficient: 0.004, skyMieDirectionalG: 0.78,
  mapViewEnabled: false, mapViewLatitude: null, mapViewLongitude: null, mapViewAltitude: 0,
  mapViewHeadingDeg: 0, mapViewScale: 1, mapViewZoom: 17.5, mapViewPitchDeg: 60, mapViewBearingDeg: -20,
  siteEnabled: false, siteRadiusM: 600, siteTerrainEnabled: true, siteImageryEnabled: true, siteImageryBrightness: 0.85,
  siteOffsetX: 0, siteOffsetZ: 0, siteElevationOffset: 0, siteRotationDeg: 0, siteScale: 1,
  backdropEnabled: false, backdropImageUrl: null, backdropRotationDeg: 0, backdropPitchDeg: 0, backdropElevation: 0,
  fogEnabled: false, fogColor: "#c9d6e0", fogDensity: 0.015, fogMatchesSky: false,
  fogHeightBandEnabled: false, fogHazeEnabled: false, fogNoiseEnabled: false, fogMovementEnabled: true,
  fogSunInteractionEnabled: true, fogBaseHeight: 0, fogTopHeight: 40, fogHaze: 0.3, fogNoiseStrength: 0.3,
  fogNoiseScale: 0.05, fogWindDirectionDeg: 0, fogWindSpeed: 0.02, fogFalloff: 1, fogMaxOpacity: 0.85,
  bloomEnabled: false, bloomStrength: 0.1, bloomRadius: 0,
  waterEnabled: false, waterDistortionScale: 3.7, waterSize: 1, waterType: "decorative", waterWavesEnabled: true,
  waterMovementEnabled: true, waterSunReflectionEnabled: true, waterEnvReflectionEnabled: true,
  waterNormalMapEnabled: true, waterHeight: 0, waterColor: "#001e0f", waterDeepColor: "#00131f",
  cloudsEnabled: false, cloudCoverage: 0.4, cloudDensity: 0.5, cloudElevation: 0.5, cloudMovementEnabled: true,
  cloudSunLightingEnabled: true, cloudShadowsEnabled: false, cloudHeight: 220, cloudThickness: 50,
  cloudThreshold: 0.45, cloudOpacity: 0.85, cloudSoftness: 0.35, cloudScale: 0.01,
  cloudWindSpeed: 0.02, cloudWindDirectionDeg: 45, cloudRaymarchSteps: 16, shadowSoftness: 0,
  lutEnabled: false, lutPreset: "bourbon64", lutIntensity: 1,
  depthOfFieldEnabled: false, depthOfFieldFocalLength: 10, depthOfFieldBokehScale: 1,
  distanceBlurEnabled: false, distanceBlurStartM: 150, distanceBlurFullM: 400, distanceBlurAmount: 0.9,
  distanceBlurRadius: 2, logarithmicDepthEnabled: false, loadingRevealEnabled: true,
  unitColorAvailable: "#22c55e", unitColorReserved: "#eab308", unitColorSold: "#ef4444", unitColorSelected: "#6b55f5",
  unitBlocksEnabled: true, unitBlocksStatusColorsEnabled: true, unitBlocksXrayEnabled: true,
  unitBlocksDefaultOpacity: 0.18, unitBlocksHoverOpacity: 0.25, unitBlocksSelectedOpacity: 0.32,
  unitBlocksSelectedOutlineEnabled: true, unitBlocksSelectedOutlineWidth: 2.5, unitBlocksSelectedScaleEnabled: false,
  unitBlocksSelectedScale: 1.05, unitBlocksSelectedFillEnabled: true, unitColorSelectedFill: "#6b55f5",
  unitBlocksSelectedXrayEnabled: false, unitPoiCameraEnabled: true, unitPoiCameraFov: 38,
  unitPoiCameraDistanceMultiplier: 3, unitPoiCameraHeightOffset: 0.5, unitPoiTransitionMs: 900,
  unitPoiAutoOcclusionCorrection: false, causticsEnabled: false, causticsScale: 0.5, causticsSpeed: 0.15,
  causticsIntensityAvailable: 1, causticsIntensityReserved: 0.4, causticsIntensitySold: 0,
  shadowsEnabled: true, antialiasEnabled: true, sections: [], sunLightEnabled: true, sunTemperatureK: 5500,
  csmEnabled: false, csmCascades: 3, csmMaxDistance: 200, csmResolution: 2048, csmSplitMode: "practical", csmMargin: 100,
  softShadowsEnabled: true, contactShadowsEnabled: false, contactShadowBlur: 0.5, contactShadowDarkness: 0.6,
  contactShadowOpacity: 0.8, contactShadowRange: 0.3, transmittedShadowsEnabled: false,
  coloredShadowsEnabled: false, transmittedShadowStrength: 0.6, giEnabled: false, giIndirectEnabled: true,
  giAOEnabled: true, giBackfaceLighting: false, giTemporalFiltering: true, giScreenSpaceSampling: true,
  giIntensity: 10, giAOIntensity: 1, giRadius: 12, giSliceCount: 1, giStepCount: 12, giExpFactor: 2,
  giThickness: 1, giLinearThickness: false, artificialLights: [], volumetricLightingEnabled: false,
  sunShaftsEnabled: true, lightVolumesEnabled: false, volumetricRaymarchSteps: 60, volumetricDensity: 0.7,
  volumetricMaxDensity: 0.5, volumetricDistanceAtten: 2,
  ssrEnabled: false, ssrIntensity: 1, ssrMaxDistance: 30, ssrThickness: 0.5, ssrQuality: 0.5,
  lensFlareEnabled: false, lensFlareIntensity: 1, motionBlurEnabled: false, motionBlurIntensity: 1,
  updatedAt: "2025-01-01T00:00:00.000Z",
};

export function defaultProject3DExperience(): Project3DExperienceDocument {
  return {
    schemaVersion: PROJECT_3D_SCHEMA_VERSION,
    revision: 1,
    config: structuredClone(DEFAULT_PROJECT_3D_CONFIG),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validStructuredRows(config: Record<string, unknown>): boolean {
  return Array.isArray(config.cameraPresets) && config.cameraPresets.length <= 100
    && Array.isArray(config.sections) && config.sections.length <= 100
    && Array.isArray(config.solarAnchors) && config.solarAnchors.length <= 100
    && Array.isArray(config.artificialLights) && config.artificialLights.length <= 200
    && isRecord(config.viewerUI);
}

function isBackdropSource(value: unknown): boolean {
  return typeof value === "string" && value.length <= 2_000 && (environmentRefFile(value) !== null || /^https:\/\/[^\s]+$/i.test(value));
}

export function parseProject3DExperience(value: unknown): Project3DExperienceDocument {
  const defaults = defaultProject3DExperience();
  if (!isRecord(value)) return defaults;
  const revision = typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision > 0 ? value.revision : 1;
  if (!isRecord(value.config)) return { ...defaults, revision };

  const candidate = value.config;
  const expected = DEFAULT_PROJECT_3D_CONFIG as unknown as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...expected };
  for (const [key, fallback] of Object.entries(expected)) {
    const supplied = candidate[key];
    if (supplied === undefined) continue;
    if (key === "backdropImageUrl") {
      // The 360° backdrop photo: an uploaded file's reference, or an https address.
      if (supplied !== null && !isBackdropSource(supplied)) throw new Error(`Invalid 3D Experience field: ${key}`);
    } else if (fallback === null) {
      if (supplied !== null && (typeof supplied !== "number" || !Number.isFinite(supplied))) throw new Error(`Invalid 3D Experience field: ${key}`);
    } else if (Array.isArray(fallback)) {
      if (!Array.isArray(supplied)) throw new Error(`Invalid 3D Experience field: ${key}`);
    } else if (typeof fallback === "object") {
      if (!isRecord(supplied)) throw new Error(`Invalid 3D Experience field: ${key}`);
    } else if (typeof supplied !== typeof fallback || (typeof supplied === "number" && !Number.isFinite(supplied))) {
      throw new Error(`Invalid 3D Experience field: ${key}`);
    }
    normalized[key] = supplied;
  }
  if (!validStructuredRows(normalized)) throw new Error("Invalid 3D Experience structured values.");
  if ((normalized.cameraNearClip as number) <= 0 || (normalized.cameraFarClip as number) <= (normalized.cameraNearClip as number)) {
    throw new Error("The camera far clip must be greater than its positive near clip.");
  }
  for (const [key, item] of Object.entries(normalized)) {
    if (typeof item === "number" && Math.abs(item) > 1_000_000) throw new Error(`3D Experience field is outside its safe range: ${key}`);
    if (typeof item === "string" && item.length > 2_000) throw new Error(`3D Experience field is too long: ${key}`);
  }
  return { schemaVersion: PROJECT_3D_SCHEMA_VERSION, revision, config: normalized as unknown as Project3DConfig };
}
