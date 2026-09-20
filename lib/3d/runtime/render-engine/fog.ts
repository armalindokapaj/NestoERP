import * as THREE from "three/webgpu";
import {
  cameraPosition,
  color as tslColor,
  dot,
  fog as tslFog,
  length as tslLength,
  mix,
  normalize,
  positionWorld,
  smoothstep,
  time,
  triNoise3D,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import type { EnvironmentConfig } from "@/lib/3d/runtime/types";

export interface FogSystem {
  node: ReturnType<typeof tslFog>;
  update: (config: EnvironmentConfig, sunDirection: THREE.Vector3, dtSeconds: number) => void;
}

const SUN_TINT_COLOR = 0xffdca8;

export function buildFogSystem(): FogSystem {
  const color = uniform(new THREE.Color(0xc9d6e0));
  const sunTint = uniform(new THREE.Color(SUN_TINT_COLOR));
  const density = uniform(0.015);
  const baseHeight = uniform(0);
  const topHeight = uniform(40);
  const heightBandOn = uniform(0);
  const haze = uniform(0);
  const noiseStrength = uniform(0);
  const noiseScale = uniform(0.05);
  const windOffset = uniform(new THREE.Vector2(0, 0));
  const falloff = uniform(1);
  const maxOpacity = uniform(0.85);
  const sunInteractionOn = uniform(0);
  const sunDirectionUniform = uniform(new THREE.Vector3(0, 1, 0));

  const distance = tslLength(cameraPosition.sub(positionWorld));

  const heightFactor = smoothstep(topHeight, baseHeight, positionWorld.y).mul(heightBandOn).add(heightBandOn.oneMinus());

  const hazeFactor = distance.mul(haze).negate().exp().oneMinus();

  const noiseUv = vec2(positionWorld.x, positionWorld.z).mul(noiseScale).add(windOffset);
  const noise = triNoise3D(vec3(noiseUv.x, positionWorld.y.mul(0.02), noiseUv.y), 1, time).mul(noiseStrength);

  const factor = density
    .mul(heightFactor)
    .add(hazeFactor)
    .add(noise)
    .clamp(0, 1)
    .pow(falloff.max(0.01))
    .mul(maxOpacity)
    .clamp(0, 1);

  const viewDir = normalize(positionWorld.sub(cameraPosition));
  const sunInfluence = dot(viewDir, sunDirectionUniform).max(0).pow(8).mul(sunInteractionOn);
  const finalColor = mix(color, sunTint, sunInfluence);

  const node = tslFog(tslColor(finalColor), factor);

  const windAccum = new THREE.Vector2(0, 0);

  function update(config: EnvironmentConfig, sunDirection: THREE.Vector3, dtSeconds: number) {
    color.value.set(config.fogMatchesSky ? "#bfe0ff" : config.fogColor);
    density.value = config.fogEnabled ? config.fogDensity : 0;
    baseHeight.value = config.fogBaseHeight;
    topHeight.value = config.fogTopHeight;
    heightBandOn.value = config.fogEnabled && config.fogHeightBandEnabled ? 1 : 0;
    haze.value = config.fogEnabled && config.fogHazeEnabled ? config.fogHaze : 0;
    noiseStrength.value = config.fogEnabled && config.fogNoiseEnabled ? config.fogNoiseStrength : 0;
    noiseScale.value = Math.max(0.0001, config.fogNoiseScale);
    falloff.value = config.fogFalloff;
    maxOpacity.value = config.fogMaxOpacity;
    sunInteractionOn.value = config.fogEnabled && config.fogSunInteractionEnabled ? 1 : 0;
    sunDirectionUniform.value.copy(sunDirection);

    if (config.fogEnabled && config.fogNoiseEnabled && config.fogMovementEnabled) {
      const dirRad = (config.fogWindDirectionDeg * Math.PI) / 180;
      windAccum.x += Math.cos(dirRad) * config.fogWindSpeed * dtSeconds;
      windAccum.y += Math.sin(dirRad) * config.fogWindSpeed * dtSeconds;
    }
    windOffset.value.copy(windAccum);
  }

  return { node, update };
}

