import type { Project3DConfig } from "@/lib/3d/runtime/types";

import { DEFAULT_PROJECT_3D_CONFIG } from "./experience";

/**
 * The Experience fields an environment preset carries: sun, sky, time of day,
 * backdrop, fog, clouds, water, bloom, lens flare and color grading. Camera,
 * quality, ground, unit styling, sections and shadows stay with the project,
 * as in the Rozaris editor.
 */
const PRESET_FIELD = /^(sun(Azimuth|Elevation|Disc)|solar|viewerTime|geo|simulationDate$|northOffsetDeg$|sky|environment|autoSun|manualSun|backdrop|fog|cloud|water|bloom|lensFlare|exposure$|toneMapping$|lut)/;

export const ENVIRONMENT_PRESET_KEYS = Object.keys(DEFAULT_PROJECT_3D_CONFIG).filter((key) => PRESET_FIELD.test(key)) as Array<keyof Project3DConfig>;

export type EnvironmentPresetConfig = Partial<Project3DConfig>;

export function pickEnvironmentPresetConfig(config: Project3DConfig): EnvironmentPresetConfig {
  return Object.fromEntries(ENVIRONMENT_PRESET_KEYS.map((key) => [key, config[key]])) as EnvironmentPresetConfig;
}

/** Only preset fields whose type matches the Experience default are applied. */
export function environmentPresetPatch(value: unknown): EnvironmentPresetConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const defaults = DEFAULT_PROJECT_3D_CONFIG as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of ENVIRONMENT_PRESET_KEYS) {
    const supplied = source[key];
    const fallback = defaults[key];
    if (supplied === undefined) continue;
    if (fallback === null ? supplied === null || typeof supplied === "number" : Array.isArray(fallback) ? Array.isArray(supplied) : typeof supplied === typeof fallback) patch[key] = supplied;
  }
  return patch as EnvironmentPresetConfig;
}
