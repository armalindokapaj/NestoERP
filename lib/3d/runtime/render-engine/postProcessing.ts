import * as THREE from "three/webgpu";
import { convertToTexture, float, getViewPosition, int, metalness, mix, mrt, normalView, output, pass, roughness, smoothstep, texture3D, uniform, uv, vec3, vec4, velocity } from "three/tsl";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import { ssgi } from "three/examples/jsm/tsl/display/SSGINode.js";
import { godrays } from "three/examples/jsm/tsl/display/GodraysNode.js";
import { bilateralBlur } from "three/examples/jsm/tsl/display/BilateralBlurNode.js";
import { gaussianBlur } from "three/examples/jsm/tsl/display/GaussianBlurNode.js";
import { ssr } from "three/examples/jsm/tsl/display/SSRNode.js";
import { traa } from "three/examples/jsm/tsl/display/TRAANode.js";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { lensflare } from "three/examples/jsm/tsl/display/LensflareNode.js";
import { dof } from "three/examples/jsm/tsl/display/DepthOfFieldNode.js";
import { motionBlur } from "three/examples/jsm/tsl/display/MotionBlur.js";
import { lut3D } from "three/examples/jsm/tsl/display/Lut3DNode.js";
import type { LightingConfig, RenderingConfig } from "@/lib/3d/runtime/types";
import { getLutResource } from "./lut";

type UniformNode = ReturnType<typeof uniform>;

function textureNodeOf(node: unknown): THREE.Node<"vec4"> {
  return (node as { getTextureNode(): THREE.Node<"vec4"> }).getTextureNode();
}

export interface ScenePostPipeline {
  pipeline: THREE.RenderPipeline;
  dofFocusDistance: UniformNode | null;
  distanceBlurAnchor: { center: UniformNode; buildingRadius: UniformNode } | null;
  update: (lighting: LightingConfig, rendering: RenderingConfig) => void;
  dispose: () => void;
}

export function computeScenePostSignature(lighting: LightingConfig, rendering: RenderingConfig): string {
  const lutReady = rendering.lutEnabled && getLutResource(rendering.lutPreset) != null;
  return [
    lighting.contactShadowsEnabled ? 1 : 0,
    lighting.giEnabled ? 1 : 0,
    lighting.volumetricLightingEnabled && lighting.sunShaftsEnabled ? 1 : 0,
    rendering.ssrEnabled ? 1 : 0,
    rendering.antialiasEnabled ? 1 : 0,
    rendering.depthOfFieldEnabled ? 1 : 0,
    rendering.distanceBlurEnabled ? 1 : 0,
    rendering.bloomEnabled ? 1 : 0,
    rendering.bloomEnabled && rendering.lensFlareEnabled ? 1 : 0,
    rendering.motionBlurEnabled ? 1 : 0,
    lutReady ? `lut:${rendering.lutPreset}` : 0,
  ].join("|");
}

function resolveDistanceBlurFull(rendering: RenderingConfig): number {
  return Math.max(rendering.distanceBlurFullM, rendering.distanceBlurStartM + 0.5);
}

export function buildScenePostPipeline(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  sun: THREE.DirectionalLight,
  lighting: LightingConfig,
  rendering: RenderingConfig
): ScenePostPipeline | null {
  const needsGI = lighting.giEnabled;
  const needsContact = lighting.contactShadowsEnabled;
  const needsVolumetric = lighting.volumetricLightingEnabled && lighting.sunShaftsEnabled;
  const isWebGPUBackend = (renderer.backend as unknown as { isWebGPUBackend?: boolean })?.isWebGPUBackend === true;
  const needsSSR = rendering.ssrEnabled && isWebGPUBackend;
  const needsTRAA = rendering.antialiasEnabled;
  const needsDOF = rendering.depthOfFieldEnabled;
  const needsDistanceBlur = rendering.distanceBlurEnabled;
  const needsBloom = rendering.bloomEnabled;
  const needsLensFlare = needsBloom && rendering.lensFlareEnabled;
  const needsMotionBlur = rendering.motionBlurEnabled;
  const lutResource = rendering.lutEnabled ? getLutResource(rendering.lutPreset) : null;
  const needsLut = lutResource != null;
  if (!needsGI && !needsContact && !needsVolumetric && !needsSSR && !needsTRAA && !needsDOF && !needsDistanceBlur && !needsBloom && !needsMotionBlur && !needsLut) {
    return null;
  }

  const needsNormal = needsContact || needsGI || needsSSR;
  const needsVelocity = needsTRAA || needsMotionBlur;

  const needsMetalRough = needsSSR;

  const scenePass = pass(scene, camera);
  scenePass.setMRT(
    mrt({
      output,
      ...(needsNormal ? { normal: normalView } : {}),
      ...(needsMetalRough ? { metalRough: vec4(metalness, roughness, 0, 0) } : {}),
      ...(needsVelocity ? { velocity } : {}),
    })
  );
  const colorNode = scenePass.getTextureNode("output");
  const depthNode = scenePass.getTextureNode("depth");
  const normalNode = needsNormal ? scenePass.getTextureNode("normal") : null;

  let chain: THREE.Node<"vec4"> = colorNode;

  let gtaoNode: ReturnType<typeof ao> | null = null;
  if (needsContact && normalNode) {
    gtaoNode = ao(depthNode, normalNode, camera);
    gtaoNode.radius.value = Math.max(0.02, lighting.contactShadowRange);
    const aoTerm = gtaoNode.getTextureNode().r;
    const darkened = vec3(1).sub(vec3(1).sub(aoTerm).mul(lighting.contactShadowDarkness));
    chain = chain.mul(vec4(darkened, 1));
  }

  let ssgiInstance: ReturnType<typeof ssgi> | null = null;
  if (needsGI && normalNode) {
    ssgiInstance = ssgi(chain, depthNode, normalNode, camera);
    ssgiInstance.sliceCount.value = lighting.giSliceCount;
    ssgiInstance.stepCount.value = lighting.giStepCount;
    ssgiInstance.aoIntensity.value = lighting.giAOEnabled ? lighting.giAOIntensity : 0;
    ssgiInstance.giIntensity.value = lighting.giIndirectEnabled ? lighting.giIntensity : 0;
    ssgiInstance.radius.value = lighting.giRadius;
    ssgiInstance.useScreenSpaceSampling.value = lighting.giScreenSpaceSampling;
    ssgiInstance.expFactor.value = lighting.giExpFactor;
    ssgiInstance.thickness.value = lighting.giThickness;
    ssgiInstance.useLinearThickness.value = lighting.giLinearThickness;
    ssgiInstance.backfaceLighting.value = lighting.giBackfaceLighting ? 1 : 0;

    const giTerm = ssgiInstance.getGINode();
    const ssgiAoTerm = ssgiInstance.getAONode().r;
    chain = chain.add(giTerm).mul(vec4(vec3(ssgiAoTerm), 1));
  }

  if (needsVolumetric) {
    const raw = godrays(depthNode, camera, sun);
    raw.density.value = lighting.volumetricDensity;
    raw.maxDensity.value = lighting.volumetricMaxDensity;
    raw.distanceAttenuation.value = lighting.volumetricDistanceAtten;
    raw.raymarchSteps.value = lighting.volumetricRaymarchSteps;
    const blurredGodrays = bilateralBlur(raw).getTextureNode();
    chain = chain.add(blurredGodrays.mul(vec3(1, 0.96, 0.88)));
  }

  let ssrNode: ReturnType<typeof ssr> | null = null;
  if (needsSSR && normalNode) {
    const metalRoughTexture = scenePass.getTextureNode("metalRough");
    const metalnessNode = metalRoughTexture.r;
    const roughnessNode = metalRoughTexture.g;
    ssrNode = ssr(colorNode, depthNode, normalNode as unknown as THREE.Node<"vec3">, {
      metalnessNode,
      roughnessNode,
      reflectNonMetals: true,
      camera,
    });
    ssrNode.maxDistance.value = rendering.ssrMaxDistance;
    ssrNode.thickness.value = rendering.ssrThickness;
    ssrNode.intensity.value = rendering.ssrIntensity;
    ssrNode.quality.value = rendering.ssrQuality;
    chain = chain.add(vec4(ssrNode.getTextureNode().rgb, 0));
  }

  let traaNode: ReturnType<typeof traa> | null = null;
  if (needsTRAA && needsVelocity) {
    const velocityNode = scenePass.getTextureNode("velocity");
    traaNode = traa(chain, depthNode, velocityNode, camera);
    chain = textureNodeOf(traaNode);
  }

  let distanceBlurNode: ReturnType<typeof gaussianBlur> | null = null;
  const cameraWorldMatrix = uniform(camera.matrixWorld);
  const cameraProjectionInverse = uniform(camera.projectionMatrixInverse);
  const distanceBlurCenter = uniform(new THREE.Vector3());
  const distanceBlurBuildingRadius = uniform(0);
  const distanceBlurStart = uniform(rendering.distanceBlurStartM);
  const distanceBlurFull = uniform(resolveDistanceBlurFull(rendering));
  const distanceBlurAmount = uniform(rendering.distanceBlurAmount);
  const distanceBlurRadius = uniform(rendering.distanceBlurRadius);
  if (needsDistanceBlur) {
    const base = convertToTexture(chain);
    distanceBlurNode = gaussianBlur(base, distanceBlurRadius, 4, { resolutionScale: 0.5 });

    const rayPoint = getViewPosition(uv(), float(0.5), cameraProjectionInverse);
    const viewPosition = rayPoint.mul(scenePass.getViewZNode().div(rayPoint.z));
    const worldPosition = cameraWorldMatrix.mul(viewPosition);
    const distanceFromBuilding = worldPosition.distance(distanceBlurCenter).sub(distanceBlurBuildingRadius).max(0);
    const blurMask = smoothstep(distanceBlurStart, distanceBlurFull, distanceFromBuilding).mul(distanceBlurAmount);
    chain = vec4(mix(base.rgb, textureNodeOf(distanceBlurNode).rgb, blurMask), base.a);
  }

  let dofNode: ReturnType<typeof dof> | null = null;
  let dofFocusDistance: UniformNode | null = null;
  let dofFocalLength: UniformNode | null = null;
  let dofBokehScale: UniformNode | null = null;
  if (needsDOF) {
    dofFocusDistance = uniform(20);
    dofFocalLength = uniform(rendering.depthOfFieldFocalLength);
    dofBokehScale = uniform(rendering.depthOfFieldBokehScale);
    dofNode = dof(chain, scenePass.getViewZNode(), dofFocusDistance, dofFocalLength, dofBokehScale);
    chain = textureNodeOf(dofNode);
  }

  let bloomNode: ReturnType<typeof bloom> | null = null;
  let lensflareNode: ReturnType<typeof lensflare> | null = null;
  const lensFlareIntensityUniform = uniform(rendering.lensFlareIntensity);
  if (needsBloom) {
    bloomNode = bloom(chain, rendering.bloomStrength, rendering.bloomRadius, 6);
    chain = chain.add(textureNodeOf(bloomNode));
    if (needsLensFlare) {
      lensflareNode = lensflare(textureNodeOf(bloomNode), {});
      chain = chain.add(textureNodeOf(lensflareNode).rgb.mul(lensFlareIntensityUniform));
    }
  }

  const motionBlurIntensityUniform = uniform(rendering.motionBlurIntensity);
  if (needsMotionBlur && needsVelocity) {
    const velocityNode = scenePass.getTextureNode("velocity");
    const scaledVelocity = velocityNode.mul(motionBlurIntensityUniform);
    chain = motionBlur(convertToTexture(chain), scaledVelocity, int(16));
  }

  const lutIntensityUniform = uniform(rendering.lutIntensity);
  if (lutResource) {
    const lutTextureNode = texture3D(lutResource.texture3D);
    chain = lut3D(chain, lutTextureNode, lutResource.size, lutIntensityUniform) as unknown as THREE.Node<"vec4">;
  }

  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputNode = chain;

  function update(lightingCfg: LightingConfig, renderingCfg: RenderingConfig) {
    if (gtaoNode) gtaoNode.radius.value = Math.max(0.02, lightingCfg.contactShadowRange);
    if (ssgiInstance) {
      ssgiInstance.sliceCount.value = lightingCfg.giSliceCount;
      ssgiInstance.stepCount.value = lightingCfg.giStepCount;
      ssgiInstance.aoIntensity.value = lightingCfg.giAOEnabled ? lightingCfg.giAOIntensity : 0;
      ssgiInstance.giIntensity.value = lightingCfg.giIndirectEnabled ? lightingCfg.giIntensity : 0;
      ssgiInstance.radius.value = lightingCfg.giRadius;
      ssgiInstance.useScreenSpaceSampling.value = lightingCfg.giScreenSpaceSampling;
      ssgiInstance.expFactor.value = lightingCfg.giExpFactor;
      ssgiInstance.thickness.value = lightingCfg.giThickness;
      ssgiInstance.useLinearThickness.value = lightingCfg.giLinearThickness;
      ssgiInstance.backfaceLighting.value = lightingCfg.giBackfaceLighting ? 1 : 0;
    }
    if (ssrNode) {
      ssrNode.maxDistance.value = renderingCfg.ssrMaxDistance;
      ssrNode.thickness.value = renderingCfg.ssrThickness;
      ssrNode.intensity.value = renderingCfg.ssrIntensity;
      ssrNode.quality.value = renderingCfg.ssrQuality;
    }
    distanceBlurStart.value = renderingCfg.distanceBlurStartM;
    distanceBlurFull.value = resolveDistanceBlurFull(renderingCfg);
    distanceBlurAmount.value = renderingCfg.distanceBlurAmount;
    distanceBlurRadius.value = renderingCfg.distanceBlurRadius;
    if (dofFocalLength) dofFocalLength.value = renderingCfg.depthOfFieldFocalLength;
    if (dofBokehScale) dofBokehScale.value = renderingCfg.depthOfFieldBokehScale;
    if (bloomNode) {
      bloomNode.strength.value = renderingCfg.bloomStrength;
      bloomNode.radius.value = renderingCfg.bloomRadius;
    }
    lensFlareIntensityUniform.value = renderingCfg.lensFlareIntensity;
    motionBlurIntensityUniform.value = renderingCfg.motionBlurIntensity;
    lutIntensityUniform.value = renderingCfg.lutIntensity;
  }

  function dispose() {
    pipeline.dispose();
    gtaoNode?.dispose();
    ssgiInstance?.dispose();
    ssrNode?.dispose();
    traaNode?.dispose();
    dofNode?.dispose();
    distanceBlurNode?.dispose();
    bloomNode?.dispose();
    lensflareNode?.dispose();
  }

  return {
    pipeline,
    dofFocusDistance,
    distanceBlurAnchor: needsDistanceBlur ? { center: distanceBlurCenter, buildingRadius: distanceBlurBuildingRadius } : null,
    update,
    dispose,
  };
}

