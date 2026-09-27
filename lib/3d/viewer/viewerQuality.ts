import type { LightingConfig, QualityPreset, RenderingConfig } from "@/lib/3d/viewer/types";
import type { QualityConfig } from "@/lib/3d/runtime/render-engine/RenderEngine";

export type ViewerQualityLevel = "auto" | "max" | "high" | "medium" | "low";

export const VIEWER_QUALITY_LEVELS: ViewerQualityLevel[] = ["auto", "max", "high", "medium", "low"];

const LEVEL_TO_PRESET: Record<Exclude<ViewerQualityLevel, "auto">, QualityPreset> = {
  max: "ultra_desktop",
  high: "high_desktop",
  medium: "balanced",
  low: "mobile_low",
};

const LEVEL_RANK: Record<Exclude<ViewerQualityLevel, "auto">, number> = {
  max: 4,
  high: 3,
  medium: 2,
  low: 1,
};

interface QualityCaps {
  gi: boolean;
  volumetricLighting: boolean;
  depthOfField: boolean;
  distanceBlur: boolean;
  motionBlur: boolean;
  contactShadows: boolean;
  csm: boolean;
  bloom: boolean;
  lensFlare: boolean;
  lut: boolean;
  shadows: boolean;
}

function capsFor(level: Exclude<ViewerQualityLevel, "auto">): QualityCaps {
  const rank = LEVEL_RANK[level];
  return {
    gi: rank >= LEVEL_RANK.max,
    volumetricLighting: rank >= LEVEL_RANK.max,
    depthOfField: rank >= LEVEL_RANK.high,
    distanceBlur: rank >= LEVEL_RANK.medium,
    motionBlur: rank >= LEVEL_RANK.high,
    contactShadows: rank >= LEVEL_RANK.medium,
    csm: rank >= LEVEL_RANK.medium,
    bloom: rank >= LEVEL_RANK.medium,
    lensFlare: rank >= LEVEL_RANK.medium,
    lut: rank >= LEVEL_RANK.medium,
    shadows: rank >= LEVEL_RANK.medium,
  };
}

export function applyViewerQuality(level: ViewerQualityLevel, config: QualityConfig): QualityConfig {
  if (level === "auto") return config;
  return { ...config, qualityPreset: LEVEL_TO_PRESET[level], customRenderScale: null, customDprCap: null };
}

export function applyViewerQualityToRendering(level: ViewerQualityLevel, config: RenderingConfig): RenderingConfig {
  if (level === "auto") return config;
  const caps = capsFor(level);
  return {
    ...config,
    bloomEnabled: config.bloomEnabled && caps.bloom,
    lensFlareEnabled: config.lensFlareEnabled && caps.lensFlare,
    depthOfFieldEnabled: config.depthOfFieldEnabled && caps.depthOfField,
    distanceBlurEnabled: config.distanceBlurEnabled && caps.distanceBlur,
    motionBlurEnabled: config.motionBlurEnabled && caps.motionBlur,
    lutEnabled: config.lutEnabled && caps.lut,
  };
}

export function applyViewerQualityToLighting(level: ViewerQualityLevel, config: LightingConfig): LightingConfig {
  if (level === "auto") return config;
  const caps = capsFor(level);
  return {
    ...config,
    shadowsEnabled: config.shadowsEnabled && caps.shadows,
    contactShadowsEnabled: config.contactShadowsEnabled && caps.contactShadows,
    csmEnabled: config.csmEnabled && caps.csm,
    giEnabled: config.giEnabled && caps.gi,
    volumetricLightingEnabled: config.volumetricLightingEnabled && caps.volumetricLighting,
  };
}
