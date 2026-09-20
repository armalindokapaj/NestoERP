import * as THREE from "three/webgpu";
import { LUTCubeLoader } from "three/examples/jsm/loaders/LUTCubeLoader.js";
import { LUT3dlLoader } from "three/examples/jsm/loaders/LUT3dlLoader.js";
import { LUTImageLoader } from "three/examples/jsm/loaders/LUTImageLoader.js";
import { LUT_PRESETS } from "@/lib/3d/runtime/viewerPresets";
import { PROJECT_3D_ASSETS } from "@/lib/3d/runtime/assets";

export interface LutResource {
  texture3D: THREE.Data3DTexture;
  size: number;
}

const cache = new Map<string, LutResource>();
const inFlight = new Map<string, Promise<LutResource | null>>();

function loadWithLoader(loader: LUTCubeLoader | LUT3dlLoader | LUTImageLoader, url: string): Promise<LutResource | null> {
  return new Promise((resolve) => {
    loader.load(
      url,
      (result: LutResource) => resolve({ texture3D: result.texture3D, size: result.size }),
      undefined,
      () => resolve(null)
    );
  });
}

export function getLutResource(presetId: string): LutResource | null {
  const cached = cache.get(presetId);
  if (cached) return cached;
  return null;
}

export function ensureLutLoading(presetId: string, onReady: () => void) {
  if (cache.has(presetId) || inFlight.has(presetId)) return;
  const preset = LUT_PRESETS.find((p) => p.id === presetId);
  if (!preset) return;
  const url = `${PROJECT_3D_ASSETS.lutRoot}/${preset.file}`;
  const loader = preset.format === "cube" ? new LUTCubeLoader() : preset.format === "3dl" ? new LUT3dlLoader() : new LUTImageLoader();
  const promise = loadWithLoader(loader, url).then((resource) => {
    inFlight.delete(presetId);
    if (resource) {
      cache.set(presetId, resource);
      onReady();
    }
    return resource;
  });
  inFlight.set(presetId, promise);
}
