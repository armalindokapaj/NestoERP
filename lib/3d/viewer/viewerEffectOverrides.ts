import type { LightingConfig, RenderingConfig } from "@/lib/3d/viewer/types";

export type EffectName = "gi" | "ssr" | "traa" | "bloom" | "motionblur" | "lut" | "dof" | "distanceblur" | "volumetric";

export const BISECTABLE_EFFECTS: EffectName[] = [
  "gi",
  "ssr",
  "traa",
  "motionblur",
  "bloom",
  "lut",
  "dof",
  "distanceblur",
  "volumetric",
];

export type EffectOverrides = Set<EffectName>;

const EFFECT_LOOKUP = new Set<string>(BISECTABLE_EFFECTS);

export function parseEffectOverrides(search: string): EffectOverrides {
  const raw = new URLSearchParams(search).get("fx");
  if (!raw) return new Set();
  const disabled: EffectOverrides = new Set();
  for (const rawToken of raw.split(",")) {
    const token = rawToken.trim().toLowerCase();
    if (token === "none") return new Set(BISECTABLE_EFFECTS);
    const name = token.startsWith("-") ? token.slice(1) : token;
    if (EFFECT_LOOKUP.has(name)) disabled.add(name as EffectName);
  }
  return disabled;
}

export function formatEffectOverrides(disabled: EffectOverrides): string {
  return [...disabled].map((name) => `-${name}`).join(",");
}

export function applyEffectOverridesToLighting(disabled: EffectOverrides, config: LightingConfig): LightingConfig {
  if (disabled.size === 0) return config;
  return {
    ...config,
    giEnabled: config.giEnabled && !disabled.has("gi"),
    volumetricLightingEnabled: config.volumetricLightingEnabled && !disabled.has("volumetric"),
  };
}

export function applyEffectOverridesToRendering(disabled: EffectOverrides, config: RenderingConfig): RenderingConfig {
  if (disabled.size === 0) return config;
  return {
    ...config,
    ssrEnabled: config.ssrEnabled && !disabled.has("ssr"),
    antialiasEnabled: config.antialiasEnabled && !disabled.has("traa"),
    bloomEnabled: config.bloomEnabled && !disabled.has("bloom"),
    motionBlurEnabled: config.motionBlurEnabled && !disabled.has("motionblur"),
    lutEnabled: config.lutEnabled && !disabled.has("lut"),
    depthOfFieldEnabled: config.depthOfFieldEnabled && !disabled.has("dof"),
    distanceBlurEnabled: config.distanceBlurEnabled && !disabled.has("distanceblur"),
  };
}
