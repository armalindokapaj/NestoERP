import { DEFAULT_PROJECT_3D_CONFIG } from "@/lib/3d/shared/experience";

/**
 * The viewer configuration a public visitor receives (ADM-04A §7): built key
 * by key from an allowlist, starting from the product defaults — not the
 * authored JSON with a few keys deleted. Every configuration key is either
 * public or withheld here, and a test fails when a new key has no decision.
 */

/** Rendering behaviour: copied as authored. */
export const PUBLIC_EXPERIENCE_KEYS = [
  "groundEnabled", "groundStyle", "groundColor", "groundFogEnabled", "groundFogRadius",
  "cameraStartDistanceMultiplier", "cameraMinDistanceMultiplier", "cameraMaxDistanceMultiplier", "cameraMaxPolarDeg", "cameraMinPolarDeg",
  "autoRotate", "idleDroneEnabled", "idleDroneDelaySec", "idleDroneOrbitDurationSec", "idleDroneClockwise", "idleDroneMotionEnabled",
  "idleDroneHeightEnabled", "idleDroneHeightAmplitude", "idleDroneDistanceEnabled", "idleDroneDistanceAmplitude", "idleDroneTargetEnabled",
  "idleDroneTargetAmplitude", "idleDroneVerticalCycles", "idleDronePhaseOffsetDeg", "idleDroneSmoothness",
  "renderingMode", "qualityPreset", "customRenderScale", "customDprCap", "adaptiveQualityEnabled", "runtimeQualityReductionEnabled",
  "interactionQualityReductionEnabled", "deviceDetectionEnabled", "glassPreset", "environmentIntensity",
  "cameraFovDesktop", "cameraFovMobile", "cameraNearClip", "cameraFarClip", "cameraMinAzimuthDeg", "cameraMaxAzimuthDeg",
  "cameraOrbitEnabled", "cameraPanEnabled", "cameraZoomEnabled", "cameraDampingEnabled", "cameraAutoFocusEnabled", "cameraSensorWidthMm",
  "exposure", "toneMapping", "sunAzimuthDeg", "sunElevationDeg", "solarControllerEnabled",
  "viewerTimeControlEnabled", "viewerTimeHours", "viewerTimeStartHours", "viewerTimeEndHours", "viewerTimeStepMinutes",
  "northOffsetDeg", "sunDiscEnabled", "autoSunIntensityEnabled", "autoSunColorEnabled", "manualSunIntensity", "manualSunColorHex",
  "environmentRefreshEnabled", "skyEnabled", "skyTurbidity", "skyRayleigh", "skyMieCoefficient", "skyMieDirectionalG",
  "fogEnabled", "fogColor", "fogDensity", "fogMatchesSky", "fogHeightBandEnabled", "fogHazeEnabled", "fogNoiseEnabled", "fogMovementEnabled",
  "fogSunInteractionEnabled", "fogBaseHeight", "fogTopHeight", "fogHaze", "fogNoiseStrength", "fogNoiseScale", "fogWindDirectionDeg",
  "fogWindSpeed", "fogFalloff", "fogMaxOpacity", "bloomEnabled", "bloomStrength", "bloomRadius",
  "waterEnabled", "waterDistortionScale", "waterSize", "waterType", "waterWavesEnabled", "waterMovementEnabled", "waterSunReflectionEnabled",
  "waterEnvReflectionEnabled", "waterNormalMapEnabled", "waterHeight", "waterColor", "waterDeepColor",
  "cloudsEnabled", "cloudCoverage", "cloudDensity", "cloudElevation", "cloudMovementEnabled", "cloudSunLightingEnabled", "cloudShadowsEnabled",
  "cloudHeight", "cloudThickness", "cloudThreshold", "cloudOpacity", "cloudSoftness", "cloudScale", "cloudWindSpeed", "cloudWindDirectionDeg",
  "cloudRaymarchSteps", "shadowSoftness", "lutEnabled", "lutPreset", "lutIntensity",
  "depthOfFieldEnabled", "depthOfFieldFocalLength", "depthOfFieldBokehScale", "distanceBlurEnabled", "distanceBlurStartM", "distanceBlurFullM",
  "distanceBlurAmount", "distanceBlurRadius", "logarithmicDepthEnabled", "loadingRevealEnabled",
  "unitColorAvailable", "unitColorReserved", "unitColorSold", "unitColorSelected", "unitBlocksEnabled", "unitBlocksStatusColorsEnabled",
  "unitBlocksXrayEnabled", "unitBlocksDefaultOpacity", "unitBlocksHoverOpacity", "unitBlocksSelectedOpacity", "unitBlocksSelectedOutlineEnabled",
  "unitBlocksSelectedOutlineWidth", "unitBlocksSelectedScaleEnabled", "unitBlocksSelectedScale", "unitBlocksSelectedFillEnabled",
  "unitColorSelectedFill", "unitBlocksSelectedXrayEnabled", "unitPoiCameraEnabled", "unitPoiCameraFov", "unitPoiCameraDistanceMultiplier",
  "unitPoiCameraHeightOffset", "unitPoiTransitionMs", "unitPoiAutoOcclusionCorrection",
  "causticsEnabled", "causticsScale", "causticsSpeed", "causticsIntensityAvailable", "causticsIntensityReserved", "causticsIntensitySold",
  "shadowsEnabled", "antialiasEnabled", "sunLightEnabled", "sunTemperatureK", "csmEnabled", "csmCascades", "csmMaxDistance", "csmResolution",
  "csmSplitMode", "csmMargin", "softShadowsEnabled", "contactShadowsEnabled", "contactShadowBlur", "contactShadowDarkness",
  "contactShadowOpacity", "contactShadowRange", "transmittedShadowsEnabled", "coloredShadowsEnabled", "transmittedShadowStrength",
  "giEnabled", "giIndirectEnabled", "giAOEnabled", "giBackfaceLighting", "giTemporalFiltering", "giScreenSpaceSampling", "giIntensity",
  "giAOIntensity", "giRadius", "giSliceCount", "giStepCount", "giExpFactor", "giThickness", "giLinearThickness",
  "volumetricLightingEnabled", "sunShaftsEnabled", "lightVolumesEnabled", "volumetricRaymarchSteps", "volumetricDensity",
  "volumetricMaxDensity", "volumetricDistanceAtten", "ssrEnabled", "ssrIntensity", "ssrMaxDistance", "ssrThickness", "ssrQuality",
  "lensFlareEnabled", "lensFlareIntensity", "motionBlurEnabled", "motionBlurIntensity",
] as const;

/** Rebuilt from their parts without author text: labels, names and building names become neutral. */
export const PUBLIC_REBUILT_KEYS = ["cameraPresets", "sections", "artificialLights", "solarAnchors", "viewerUI"] as const;

/**
 * Never sent. Location (coordinates, map and site imagery around the real
 * address, the geographic sun path) is not in this increment's public content;
 * the backdrop is an arbitrary URL; the rest is authoring state.
 */
export const WITHHELD_EXPERIENCE_KEYS = [
  "status", "updatedAt", "cameraHelperEnabled",
  "geoLatitude", "geoLongitude", "solarPathMode", "simulationDate",
  "mapViewEnabled", "mapViewLatitude", "mapViewLongitude", "mapViewAltitude", "mapViewHeadingDeg", "mapViewScale", "mapViewZoom", "mapViewPitchDeg", "mapViewBearingDeg",
  "siteEnabled", "siteRadiusM", "siteTerrainEnabled", "siteImageryEnabled", "siteImageryBrightness", "siteOffsetX", "siteOffsetZ", "siteElevationOffset", "siteRotationDeg", "siteScale",
  "backdropEnabled", "backdropImageUrl", "backdropRotationDeg", "backdropPitchDeg", "backdropElevation",
] as const;

type Config = Record<string, unknown>;
type Vec = { x: number; y: number; z: number };

const num = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const vec = (value: unknown): Vec => {
  const v = (value ?? {}) as Partial<Vec>;
  return { x: num(v.x), y: num(v.y), z: num(v.z) };
};
const list = (value: unknown): Config[] => (Array.isArray(value) ? value.filter((item): item is Config => Boolean(item) && typeof item === "object") : []);

const VIEWER_UI_KEYS = [
  "home", "unitSearch", "hoverEnabled", "selectEnabled", "showUnitInfo", "sectionsEnabled", "sunPresetEnabled", "unitInteractionEnabled",
  "highlightEnabled", "statusColorsEnabled", "isolationEnabled", "floorIsolationEnabled", "filtersEnabled", "filterFloorEnabled",
  "filterAvailabilityEnabled", "filterBedroomsEnabled", "filterTypeEnabled", "resetEnabled", "fullscreenEnabled", "shotsMenuEnabled",
  "screenshotEnabled", "shareEnabled",
] as const;

/**
 * The public viewer configuration of an authored one. `availability` decides
 * whether status colours and the availability filter can show anything; unit
 * pages, prices and the map never appear publicly in this increment.
 */
export function projectPublicExperience(authored: Config, options: { availability: boolean }): Config {
  const defaults = DEFAULT_PROJECT_3D_CONFIG as unknown as Config;
  const out: Config = {};
  for (const key of PUBLIC_EXPERIENCE_KEYS) out[key] = key in authored ? authored[key] : defaults[key];
  for (const key of WITHHELD_EXPERIENCE_KEYS) out[key] = defaults[key];
  // The withheld location falls back to neutral values the renderer accepts.
  // Coordinates are zeroed rather than defaulted: even the product default is a real place.
  Object.assign(out, { status: "published", solarPathMode: "manual", geoLatitude: 0, geoLongitude: 0, mapViewLatitude: null, mapViewLongitude: null, mapViewEnabled: false, siteEnabled: false, backdropEnabled: false, backdropImageUrl: null, cameraHelperEnabled: false });

  out.cameraPresets = list(authored.cameraPresets).slice(0, 50).map((preset, index) => ({
    id: `c${index + 1}`, label: `View ${index + 1}`, position: vec(preset.position), target: vec(preset.target), fov: num(preset.fov, 45), durationMs: num(preset.durationMs, 1200),
  }));
  out.sections = list(authored.sections).slice(0, 200).map((section, index) => ({
    id: `s${index + 1}`, name: `Section ${index + 1}`, scope: section.scope === "building" ? "building" : "project",
    centerX: num(section.centerX), centerZ: num(section.centerZ), widthM: num(section.widthM), depthM: num(section.depthM), rotationDeg: num(section.rotationDeg),
    heightM: num(section.heightM), bottomEnabled: section.bottomEnabled === true, heightOnly: section.heightOnly === true, fillGapsEnabled: section.fillGapsEnabled === true,
    fillColor: typeof section.fillColor === "string" && /^#[0-9a-f]{3,8}$/i.test(section.fillColor) ? section.fillColor : "#ffffff",
    ...(section.cameraPreset && typeof section.cameraPreset === "object" ? { cameraPreset: { position: vec((section.cameraPreset as Config).position), target: vec((section.cameraPreset as Config).target), fov: num((section.cameraPreset as Config).fov, 45) } } : {}),
    hidden: section.hidden === true,
  }));
  out.artificialLights = list(authored.artificialLights).slice(0, 100)
    // IES profiles are URLs; those lights are left out rather than pointed elsewhere.
    .filter((light) => light.type !== "ies")
    .map((light, index) => ({
      id: `l${index + 1}`, name: `Light ${index + 1}`, type: ["point", "spot", "rect"].includes(String(light.type)) ? light.type : "point",
      enabled: light.enabled === true, shadowsEnabled: light.shadowsEnabled === true, volumetricEnabled: light.volumetricEnabled === true, helperEnabled: false,
      position: vec(light.position), target: vec(light.target), colorHex: typeof light.colorHex === "string" && /^#[0-9a-f]{3,8}$/i.test(light.colorHex) ? light.colorHex : "#ffffff",
      temperatureK: typeof light.temperatureK === "number" ? light.temperatureK : null, intensity: num(light.intensity), distance: num(light.distance), decay: num(light.decay, 2),
      angleDeg: num(light.angleDeg, 30), penumbra: num(light.penumbra), width: num(light.width, 1), height: num(light.height, 1), iesProfileUrl: null,
    }));
  out.solarAnchors = list(authored.solarAnchors).slice(0, 48).map((anchor, index) => ({ id: `a${index + 1}`, timeHours: num(anchor.timeHours), elevationDeg: num(anchor.elevationDeg), azimuthDeg: num(anchor.azimuthDeg) }));

  const ui = (authored.viewerUI && typeof authored.viewerUI === "object" ? authored.viewerUI : defaults.viewerUI) as Config;
  const viewerUI: Config = {};
  for (const key of VIEWER_UI_KEYS) if (typeof ui[key] === "boolean") viewerUI[key] = ui[key];
  viewerUI.home = ui.home !== false;
  viewerUI.unitSearch = ui.unitSearch !== false;
  // Never publicly: unit pages, and price filters (prices are excluded).
  viewerUI.unitPageLinkEnabled = false;
  viewerUI.filterPriceEnabled = false;
  if (!options.availability) {
    viewerUI.statusColorsEnabled = false;
    viewerUI.filterAvailabilityEnabled = false;
    out.unitBlocksStatusColorsEnabled = false;
  }
  out.viewerUI = viewerUI;
  return out;
}
