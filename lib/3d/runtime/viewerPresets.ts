import type { GlassPreset, MaterialPresetId, QualityPreset, Unit } from "@/lib/3d/runtime/types";

export const STATUS_COLOR: Record<Unit["status"], number> = {
  available: 0x23845e,
  reserved: 0xa66a12,
  sold: 0x9a9aa3,
};

export const UNIT_BOX_COLOR: Record<Unit["status"], number> = {
  available: 0x22c55e,
  reserved: 0xeab308,
  sold: 0xef4444,
};
export const UNIT_BOX_OPACITY = 0.2;
export const UNIT_BOX_SELECTED_OPACITY = 0.65;

export const SELECTED_COLOR = 0x6b55f5;

export const SKY_DOME_SCALE = 1600;
export const WATER_PLANE_SIZE = 1600;
export const GROUND_INFINITE_SIZE = 1600;

export const SUN_HOUR_MIN = 6;
export const SUN_HOUR_MAX = 20;

export const SUN_PRESET_HOURS: { key: string; hour: number }[] = [
  { key: "project.presetMorning", hour: 8 },
  { key: "project.presetMidday", hour: 12 },
  { key: "project.presetAfternoon", hour: 15 },
  { key: "project.presetEvening", hour: 18 },
  { key: "project.presetNight", hour: 20 },
];

export interface QualityTierSettings {
  renderScale: number;
  dprCap: number;
  shadowMapSize: number;
  bloom: boolean;
  antialias: boolean;
  ssgi: boolean;
  lut: boolean;
  depthOfField: boolean;
  caustics: boolean;
}

export const QUALITY_TIERS: Record<QualityPreset, QualityTierSettings> = {
  ultra_desktop: {
    renderScale: 1,
    dprCap: 2,
    shadowMapSize: 4096,
    bloom: true,
    antialias: true,
    ssgi: false,
    lut: true,
    depthOfField: true,
    caustics: true,
  },
  high_desktop: {
    renderScale: 0.95,
    dprCap: 2,
    shadowMapSize: 2048,
    bloom: true,
    antialias: true,
    ssgi: false,
    lut: true,
    depthOfField: true,
    caustics: true,
  },
  balanced: {
    renderScale: 0.8,
    dprCap: 1.5,
    shadowMapSize: 1536,
    bloom: true,
    antialias: true,
    ssgi: false,
    lut: true,
    depthOfField: false,
    caustics: true,
  },
  mobile_high: {
    renderScale: 0.75,
    dprCap: 1.25,
    shadowMapSize: 1024,
    bloom: false,
    antialias: false,
    ssgi: false,
    lut: false,
    depthOfField: false,
    caustics: false,
  },
  mobile_low: {
    renderScale: 0.6,
    dprCap: 1,
    shadowMapSize: 512,
    bloom: false,
    antialias: false,
    ssgi: false,
    lut: false,
    depthOfField: false,
    caustics: false,
  },
  custom: {
    renderScale: 0.95,
    dprCap: 2,
    shadowMapSize: 2048,
    bloom: true,
    antialias: true,
    ssgi: false,
    lut: true,
    depthOfField: true,
    caustics: true,
  },
};

export const LUT_PRESETS = [
  { id: "bourbon64", label: "Bourbon 64", file: "Bourbon 64.CUBE", format: "cube" },
  { id: "chemical168", label: "Chemical 168", file: "Chemical 168.CUBE", format: "cube" },
  { id: "clayton33", label: "Clayton 33", file: "Clayton 33.CUBE", format: "cube" },
  { id: "cubicle99", label: "Cubicle 99", file: "Cubicle 99.CUBE", format: "cube" },
  { id: "remy24", label: "Remy 24", file: "Remy 24.CUBE", format: "cube" },
  { id: "presetproCinematic", label: "Presetpro Cinematic", file: "Presetpro-Cinematic.3dl", format: "3dl" },
  { id: "neutral", label: "Neutral", file: "NeutralLUT.png", format: "image" },
  { id: "blackAndWhite", label: "Black & White", file: "B&WLUT.png", format: "image" },
  { id: "night", label: "Night", file: "NightLUT.png", format: "image" },
] as const satisfies readonly { id: string; label: string; file: string; format: "cube" | "3dl" | "image" }[];

export const LUT_PRESET_IDS = LUT_PRESETS.map((p) => p.id) as [string, ...string[]];

export const ADAPTIVE_DOWNGRADE_ORDER: (keyof Pick<
  QualityTierSettings,
  "bloom" | "antialias" | "lut" | "depthOfField"
>)[] = [
  "depthOfField",
  "bloom",
  "antialias",
];

export const QUALITY_PRESET_ORDER: QualityPreset[] = [
  "ultra_desktop",
  "high_desktop",
  "balanced",
  "mobile_high",
  "mobile_low",
];

export function pickDefaultQualityTier(): QualityPreset {
  if (typeof navigator === "undefined") return "high_desktop";
  const ua = navigator.userAgent ?? "";
  const isMobileUA = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  const coarsePointer =
    typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  if (isMobileUA || coarsePointer) {
    return deviceMemory <= 3 ? "mobile_low" : "mobile_high";
  }
  if (deviceMemory <= 4) return "balanced";
  if (deviceMemory >= 8 && dpr >= 2) return "ultra_desktop";
  return "high_desktop";
}

export interface GlassTierSettings {
  transmission: number;
  roughness: number;
  ior: number;
  thickness: number;
}

export const GLASS_TIERS: Record<GlassPreset, GlassTierSettings> = {
  performance: { transmission: 0, roughness: 0.25, ior: 1.5, thickness: 0 },
  standard: { transmission: 0.9, roughness: 0.08, ior: 1.5, thickness: 0.02 },
  premium: { transmission: 1, roughness: 0.02, ior: 1.52, thickness: 0.05 },
};
export const GLASS_NODE_PATTERN = /^Glass_/i;

export interface MaterialPresetSettings {
  label: string;
  color: number;
  roughness: number;
  metalness: number;
}

export const MATERIAL_PRESETS: Record<MaterialPresetId, MaterialPresetSettings> = {
  concrete: { label: "Concrete", color: 0x9a9891, roughness: 0.9, metalness: 0 },
  plaster: { label: "Plaster", color: 0xe8e4da, roughness: 0.85, metalness: 0 },
  stone: { label: "Stone", color: 0x8a8378, roughness: 0.75, metalness: 0 },
  wood: { label: "Wood", color: 0x8a5a34, roughness: 0.55, metalness: 0 },
  aluminium: { label: "Aluminium", color: 0xb8bcc2, roughness: 0.35, metalness: 0.85 },
  steel: { label: "Steel", color: 0x6e737a, roughness: 0.4, metalness: 0.9 },
  chrome: { label: "Chrome", color: 0xd8dade, roughness: 0.05, metalness: 1 },
  ceramic: { label: "Ceramic", color: 0xf0efe9, roughness: 0.15, metalness: 0 },
};

export const FOG_SKY_HORIZON_COLOR = "#bfe0ff";

