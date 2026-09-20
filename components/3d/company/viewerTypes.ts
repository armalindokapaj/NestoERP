import type { CameraConfig, DetailModelEntry, QualityConfig, RenderEngineCallbacks } from "@/lib/3d/runtime/render-engine/RenderEngine";
import type {
  CameraPreset,
  EnvironmentConfig,
  LightingConfig,
  RenderingConfig,
  Section,
  SiteRuntimeConfig,
  UnitsConfig,
} from "@/lib/3d/runtime/types";

export interface ThreeProjectViewerHandle {
  resetView: () => void;
  captureScreenshot: () => Promise<string | null>;
  computeGroundAlignOffset: (slotId: string) => number | null;
  getCameraState: () => { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; fov: number } | null;
  flyToPreset: (preset: CameraPreset) => void;
  showCameraHelperFor: (preset: CameraPreset | null) => void;
  activateSection: (section: Section | null, options?: { showIndicator?: boolean }) => void;
  getContentBounds: () => { centerX: number; centerZ: number; minY: number; maxY: number; sizeX: number; sizeZ: number } | null;
  getEffectiveRenderScale: () => number;
  setSelectedUnit: (unitId: string | null) => void;
  setUnitsMode: (enabled: boolean) => void;
  setUnitStatusFilters: (filters: { available: boolean; reserved: boolean; sold: boolean }) => void;
  setUnitIdFilter: (unitIds: string[] | null) => void;
  isolateUnit: (unitId: string | null) => void;
  hoverUnit: (unitId: string | null) => void;
  focusUnit: (unitId: string) => boolean;
  getUnitViewportState: (unitId: string) => { onScreen: boolean; coverage: number; poiAuthored: boolean } | null;
  revealUnit: (unitId: string, screenBiasY?: number) => boolean;
  revealUnits: (unitIds: string[], screenBiasY?: number, frameFraction?: number) => boolean;
  revealArea: (
    area: { centerX: number; centerZ: number; y: number; radius: number },
    screenBiasY?: number,
    frameFraction?: number
  ) => boolean;
  resetUnitCamera: () => void;
  getUnitRegistrySnapshot: () => { unitId: string; unitCode: string; poiYawDeg: number }[];
  resetIdleTimer: () => void;
  isIdleDroneActive: () => boolean;
  setIdleDroneSuspended: (suspended: boolean) => void;
  previewIdleDrone: () => void;
  stopIdleDronePreview: () => void;
  setShowDronePath: (enabled: boolean) => void;
}

export interface ThreeProjectViewerProps {
  detailModels: DetailModelEntry[];
  className?: string;
  unitsConfig?: UnitsConfig;
  siteConfig?: SiteRuntimeConfig;
  onSiteStatus?: RenderEngineCallbacks["onSiteStatus"];
  onRendererFacts?: RenderEngineCallbacks["onRendererFacts"];
  onContextLost?: RenderEngineCallbacks["onContextLost"];
  onUnitClick?: (unitId: string | null) => void;
  onUnitHover?: (unitId: string | null) => void;
  cameraConfig?: CameraConfig;
  qualityConfig?: QualityConfig;
  environmentConfig?: EnvironmentConfig;
  lightingConfig?: LightingConfig;
  renderingConfig?: RenderingConfig;
  showPerfStats?: boolean;
  onPerfStats?: (
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
  onModelLoadStatus?: RenderEngineCallbacks["onModelLoadStatus"];
  onReady?: () => void;
}

