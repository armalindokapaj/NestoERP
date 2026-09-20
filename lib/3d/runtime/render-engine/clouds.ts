import * as THREE from "three/webgpu";
import {
  cameraPosition,
  clamp,
  dot,
  float,
  Fn,
  Loop,
  max as tslMax,
  mix,
  normalize,
  positionWorld,
  select,
  smoothstep,
  time,
  triNoise3D,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import type { EnvironmentConfig } from "@/lib/3d/runtime/types";

const MAX_STEPS = 24;
const CLOUD_PLANE_SIZE = 3000;

export interface CloudSystem {
  mesh: THREE.Mesh;
  update: (config: EnvironmentConfig, sunDirection: THREE.Vector3, cameraPos: THREE.Vector3, dtSeconds: number) => void;
  getWindOffset: () => THREE.Vector2;
  dispose: () => void;
}

export function buildCloudSystem(): CloudSystem {
  const height = uniform(220);
  const thickness = uniform(50);
  const threshold = uniform(0.45);
  const softness = uniform(0.35);
  const scale = uniform(0.01);
  const coverage = uniform(0.4);
  const density = uniform(0.5);
  const opacity = uniform(0);
  const stepCount = uniform(16);
  const sunLightingOn = uniform(1);
  const sunDirectionUniform = uniform(new THREE.Vector3(0, 1, 0));
  const windOffset = uniform(new THREE.Vector2(0, 0));

  const colorNode = Fn(() => {
    const rayDir = normalize(positionWorld.sub(cameraPosition)).toVar();
    const bottomY = height;
    const topY = height.add(thickness);

    const safeRy = select(rayDir.y.abs().lessThan(0.001), float(0.001), rayDir.y);
    const tBottom = bottomY.sub(cameraPosition.y).div(safeRy);
    const tTop = topY.sub(cameraPosition.y).div(safeRy);
    const tEntry = tBottom.min(tTop).max(0).toVar();
    const tExit = tBottom.max(tTop).toVar();

    const alpha = float(0).toVar();
    const litColor = vec3(0).toVar();
    const span = tExit.sub(tEntry).max(0);
    const dt = span.div(float(MAX_STEPS));

    Loop(MAX_STEPS, ({ i }) => {
      const stepActive = select(float(i).lessThan(stepCount), float(1), float(0));
      const t = tEntry.add(dt.mul(float(i)).add(dt.mul(0.5)));
      const samplePos = cameraPosition.add(rayDir.mul(t));
      const uv = vec2(samplePos.x, samplePos.z).mul(scale).add(windOffset);
      const raw = triNoise3D(vec3(uv.x, samplePos.y.mul(0.01), uv.y), 1, time);
      const shaped = smoothstep(threshold.oneMinus().sub(softness), threshold.oneMinus().add(softness), raw.add(coverage.sub(0.5)));
      const stepDensity = shaped.mul(density).mul(dt.mul(0.04)).mul(stepActive);

      const sunFactor = select(sunLightingOn.greaterThan(0.5), dot(rayDir, sunDirectionUniform).mul(0.5).add(0.5), float(0.7));
      const stepColor = mix(vec3(0.55, 0.57, 0.62), vec3(1.0, 0.98, 0.94), sunFactor);

      const contribution = stepDensity.mul(alpha.oneMinus());
      litColor.addAssign(stepColor.mul(contribution));
      alpha.addAssign(contribution);
    });

    return vec3(litColor);
  })();

  const opacityNode = Fn(() => {
    const rayDir = normalize(positionWorld.sub(cameraPosition)).toVar();
    const bottomY = height;
    const topY = height.add(thickness);
    const safeRy = select(rayDir.y.abs().lessThan(0.001), float(0.001), rayDir.y);
    const tBottom = bottomY.sub(cameraPosition.y).div(safeRy);
    const tTop = topY.sub(cameraPosition.y).div(safeRy);
    const tEntry = tBottom.min(tTop).max(0);
    const tExit = tBottom.max(tTop);
    const crosses = select(tExit.greaterThan(tEntry), float(1), float(0));
    return crosses.mul(opacity);
  })();

  const material = new THREE.NodeMaterial();
  material.colorNode = colorNode;
  material.opacityNode = clamp(opacityNode, 0, 1);
  material.transparent = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.fog = false;

  const geometry = new THREE.PlaneGeometry(CLOUD_PLANE_SIZE, CLOUD_PLANE_SIZE);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.frustumCulled = false;
  mesh.renderOrder = -5;
  mesh.visible = false;

  const windAccum = new THREE.Vector2(0, 0);

  function update(config: EnvironmentConfig, sunDirection: THREE.Vector3, cameraPos: THREE.Vector3, dtSeconds: number) {
    const active = config.cloudsEnabled;
    mesh.visible = active;
    if (!active) return;

    height.value = config.cloudHeight;
    thickness.value = Math.max(1, config.cloudThickness);
    threshold.value = config.cloudThreshold;
    softness.value = Math.max(0.01, config.cloudSoftness);
    scale.value = Math.max(0.0001, config.cloudScale);
    coverage.value = config.cloudCoverage;
    density.value = config.cloudDensity;
    opacity.value = config.cloudOpacity;
    stepCount.value = Math.max(1, Math.min(MAX_STEPS, config.cloudRaymarchSteps));
    sunLightingOn.value = config.cloudSunLightingEnabled ? 1 : 0;
    sunDirectionUniform.value.copy(sunDirection);

    mesh.position.set(cameraPos.x, config.cloudHeight + config.cloudThickness / 2, cameraPos.z);

    if (config.cloudMovementEnabled) {
      const dirRad = (config.cloudWindDirectionDeg * Math.PI) / 180;
      windAccum.x += Math.cos(dirRad) * config.cloudWindSpeed * dtSeconds;
      windAccum.y += Math.sin(dirRad) * config.cloudWindSpeed * dtSeconds;
    }
    windOffset.value.copy(windAccum);
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
  }

  function getWindOffset() {
    return windAccum;
  }

  return { mesh, update, getWindOffset, dispose };
}

export function cloudShadowFactor(
  groundWorldPos: THREE.Node<"vec3">,
  sunDirection: THREE.Node<"vec3">,
  cloudHeight: THREE.Node<"float">,
  cloudScale: THREE.Node<"float">,
  coverage: THREE.Node<"float">,
  windOffset: THREE.Node<"vec2">,
  strength: THREE.Node<"float">
) {
  const sunHorizontal = vec2(sunDirection.x, sunDirection.z);
  const safeUp = tslMax(sunDirection.y, 0.05);
  const projected = vec2(groundWorldPos.x, groundWorldPos.z).add(sunHorizontal.mul(cloudHeight.div(safeUp)));
  const uv = projected.mul(cloudScale).add(windOffset);
  const raw = triNoise3D(vec3(uv.x, float(0), uv.y), 1, time);
  const mask = smoothstep(float(0.3), float(0.7), raw.add(coverage.sub(0.5)));
  return mix(float(1), mask.oneMinus(), strength);
}

