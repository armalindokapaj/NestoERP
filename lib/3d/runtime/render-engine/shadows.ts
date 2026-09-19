import * as THREE from "three/webgpu";
import { CSMShadowNode } from "three/examples/jsm/csm/CSMShadowNode.js";
import { color as tslColor, vec4 } from "three/tsl";
import { GLASS_NODE_PATTERN } from "@/lib/3d/runtime/viewerPresets";
import type { LightingConfig } from "@/lib/3d/runtime/types";

export interface CSMSystem {
  node: InstanceType<typeof CSMShadowNode>;
  updateFrustums: () => void;
  dispose: () => void;
}

export function buildCSMSystem(light: THREE.DirectionalLight, config: LightingConfig): CSMSystem {
  const node = new CSMShadowNode(light, {
    cascades: config.csmCascades,
    maxFar: config.csmMaxDistance,
    mode: config.csmSplitMode,
    lightMargin: config.csmMargin,
  });
  light.shadow.shadowNode = node;

  function updateFrustums() {
    if (!node.camera || !node.mainFrustum) return;
    node.cascades = config.csmCascades;
    node.maxFar = config.csmMaxDistance;
    node.mode = config.csmSplitMode;
    node.lightMargin = config.csmMargin;
    node.updateFrustums();
  }

  function dispose() {
    if (light.shadow.shadowNode === node) light.shadow.shadowNode = undefined;
    node.dispose();
  }

  return { node, updateFrustums, dispose };
}

export function applyTransmittedShadows(root: THREE.Object3D, config: LightingConfig) {
  const alpha = 1 - Math.max(0, Math.min(1, config.transmittedShadowStrength));
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !GLASS_NODE_PATTERN.test(mesh.name)) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      const nodeMat = mat as THREE.MeshPhysicalMaterial & { castShadowNode?: THREE.Node<"vec4"> | null };
      if (!config.transmittedShadowsEnabled) {
        nodeMat.castShadowNode = null;
        continue;
      }
      const tint = config.coloredShadowsEnabled && nodeMat.color ? tslColor(nodeMat.color) : tslColor(0x808080);
      nodeMat.castShadowNode = vec4(tint, alpha);
    }
  });
}

export function setShadowMapTransmitted(renderer: THREE.WebGPURenderer, enabled: boolean) {
  renderer.shadowMap.transmitted = enabled;
}

