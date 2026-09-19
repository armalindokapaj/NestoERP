import * as THREE from "three/webgpu";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Project3DConfig } from "@/lib/3d/runtime/types";

export type IdleDroneConfig = Pick<
  Project3DConfig,
  | "idleDroneEnabled"
  | "idleDroneDelaySec"
  | "idleDroneOrbitDurationSec"
  | "idleDroneClockwise"
  | "idleDroneMotionEnabled"
  | "idleDroneHeightEnabled"
  | "idleDroneHeightAmplitude"
  | "idleDroneDistanceEnabled"
  | "idleDroneDistanceAmplitude"
  | "idleDroneTargetEnabled"
  | "idleDroneTargetAmplitude"
  | "idleDroneVerticalCycles"
  | "idleDronePhaseOffsetDeg"
  | "idleDroneSmoothness"
>;

export interface IdleDroneBounds {
  center: THREE.Vector3;
  buildingHeight: number;
  groundMinY: number;
  boundingRadius: number;
}

export interface IdleDroneStepOptions {
  transitionInFlight: boolean;
  prefersReducedMotion: boolean;
  tabHidden: boolean;
}

const TWO_PI = Math.PI * 2;
const MIN_DISTANCE_RADIUS_MULTIPLIER = 1.25;
const MIN_HEIGHT_SAFETY_RATIO = 0.12;
const SMOOTHING_TAU_MIN_SEC = 0.05;
const SMOOTHING_TAU_MAX_SEC = 2.2;

const DISTANCE_WAVE_FREQUENCY = 0.5;
const DISTANCE_WAVE_PHASE = 1.3;
const TARGET_WAVE_FREQUENCY = 0.75;
const TARGET_WAVE_PHASE = 2.6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dampingFactor(smoothness: number, dtSeconds: number): number {
  const tau = SMOOTHING_TAU_MIN_SEC + clamp(smoothness, 0, 1) * (SMOOTHING_TAU_MAX_SEC - SMOOTHING_TAU_MIN_SEC);
  return 1 - Math.exp(-dtSeconds / tau);
}

export class IdleDroneController {
  private config: IdleDroneConfig | null = null;
  private bounds: IdleDroneBounds | null = null;

  private active = false;
  private preview = false;
  private suspended = false;
  private lastInteractionAt = 0;
  private angle = 0;
  private baseDistance = 0;
  private baseHeight = 0;

  setConfig(config: IdleDroneConfig) {
    this.config = config;
  }

  setBounds(bounds: IdleDroneBounds) {
    this.bounds = bounds;
  }

  notifyInteraction(now: number) {
    this.lastInteractionAt = now;
    this.active = false;
    this.preview = false;
  }

  setSuspended(suspended: boolean) {
    this.suspended = suspended;
    if (suspended) this.active = false;
  }

  startPreview() {
    this.preview = true;
    this.active = true;
  }

  stopPreview() {
    this.preview = false;
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  private activate(camera: THREE.PerspectiveCamera, controls: OrbitControls, bounds: IdleDroneBounds) {
    const dx = camera.position.x - bounds.center.x;
    const dz = camera.position.z - bounds.center.z;
    this.angle = Math.atan2(dx, dz);

    const minDistance = Math.max(bounds.boundingRadius * MIN_DISTANCE_RADIUS_MULTIPLIER, controls.minDistance);
    const maxDistance = Number.isFinite(controls.maxDistance) ? controls.maxDistance : minDistance * 2;
    this.baseDistance = clamp(Math.hypot(dx, dz), Math.min(minDistance, maxDistance), Math.max(minDistance, maxDistance));

    const minY = bounds.groundMinY + bounds.buildingHeight * MIN_HEIGHT_SAFETY_RATIO;
    this.baseHeight = Math.max(camera.position.y, minY);

    this.active = true;
  }

  step(now: number, dtSeconds: number, camera: THREE.PerspectiveCamera, controls: OrbitControls, opts: IdleDroneStepOptions) {
    const { config, bounds } = this;
    if (!config || !bounds) return;
    if (opts.transitionInFlight) return;
    if (opts.tabHidden) return;
    if (this.suspended) return;

    if (!this.preview) {
      if (!config.idleDroneEnabled || opts.prefersReducedMotion) {
        this.active = false;
        return;
      }
      if (!this.active) {
        const idleForMs = now - this.lastInteractionAt;
        if (idleForMs < config.idleDroneDelaySec * 1000) return;
        this.activate(camera, controls, bounds);
      }
    } else if (!this.active) {
      this.activate(camera, controls, bounds);
    }

    const orbitDurationSec = Math.max(1, config.idleDroneOrbitDurationSec);
    const angularSpeed = (TWO_PI / orbitDurationSec) * (config.idleDroneClockwise ? 1 : -1);
    this.angle += angularSpeed * dtSeconds;

    const phase = THREE.MathUtils.degToRad(config.idleDronePhaseOffsetDeg);
    const motionOn = config.idleDroneMotionEnabled;

    const heightWave = Math.sin(this.angle * Math.max(1, config.idleDroneVerticalCycles) + phase);
    const heightAmplitude = bounds.buildingHeight * clamp(config.idleDroneHeightAmplitude, 0, 1);
    const heightOn = motionOn && config.idleDroneHeightEnabled;
    let desiredY = this.baseHeight + (heightOn ? heightWave * heightAmplitude : 0);
    const minY = bounds.groundMinY + bounds.buildingHeight * MIN_HEIGHT_SAFETY_RATIO;
    desiredY = Math.max(desiredY, minY);

    const distanceWave = Math.sin(this.angle * DISTANCE_WAVE_FREQUENCY + phase + DISTANCE_WAVE_PHASE);
    const distanceOn = motionOn && config.idleDroneDistanceEnabled;
    let desiredDistance = this.baseDistance * (1 + (distanceOn ? distanceWave * clamp(config.idleDroneDistanceAmplitude, 0, 1) : 0));
    const minDistance = Math.max(bounds.boundingRadius * MIN_DISTANCE_RADIUS_MULTIPLIER, controls.minDistance);
    const maxDistance = Number.isFinite(controls.maxDistance) ? controls.maxDistance : minDistance * 2;
    desiredDistance = clamp(desiredDistance, Math.min(minDistance, maxDistance), Math.max(minDistance, maxDistance));

    const targetWave = Math.sin(this.angle * TARGET_WAVE_FREQUENCY + phase + TARGET_WAVE_PHASE);
    const targetOn = motionOn && config.idleDroneTargetEnabled;
    const targetOffsetY = bounds.buildingHeight * clamp(config.idleDroneTargetAmplitude, 0, 1) * (targetOn ? targetWave : 0);

    const desiredX = bounds.center.x + Math.sin(this.angle) * desiredDistance;
    const desiredZ = bounds.center.z + Math.cos(this.angle) * desiredDistance;

    const k = dampingFactor(config.idleDroneSmoothness, dtSeconds);
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, desiredX, k);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, desiredY, k);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, desiredZ, k);
    controls.target.x = THREE.MathUtils.lerp(controls.target.x, bounds.center.x, k);
    controls.target.y = THREE.MathUtils.lerp(controls.target.y, bounds.center.y + targetOffsetY, k);
    controls.target.z = THREE.MathUtils.lerp(controls.target.z, bounds.center.z, k);
  }

  getPathPoints(samples = 64): { high: THREE.Vector3[]; mid: THREE.Vector3[]; low: THREE.Vector3[] } | null {
    const { config, bounds } = this;
    if (!config || !bounds) return null;
    const distance = Math.max(bounds.boundingRadius * MIN_DISTANCE_RADIUS_MULTIPLIER, this.baseDistance || bounds.boundingRadius * 1.6);
    const heightAmplitude = config.idleDroneHeightEnabled && config.idleDroneMotionEnabled ? bounds.buildingHeight * clamp(config.idleDroneHeightAmplitude, 0, 1) : 0;
    const baseY = this.baseHeight || bounds.center.y + bounds.buildingHeight * 0.5;
    const ring = (y: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= samples; i++) {
        const a = (i / samples) * TWO_PI;
        pts.push(new THREE.Vector3(bounds.center.x + Math.sin(a) * distance, y, bounds.center.z + Math.cos(a) * distance));
      }
      return pts;
    };
    return { high: ring(baseY + heightAmplitude), mid: ring(baseY), low: ring(Math.max(bounds.groundMinY + bounds.buildingHeight * MIN_HEIGHT_SAFETY_RATIO, baseY - heightAmplitude)) };
  }

  reset() {
    this.config = null;
    this.bounds = null;
    this.active = false;
    this.preview = false;
    this.suspended = false;
    this.lastInteractionAt = 0;
    this.angle = 0;
    this.baseDistance = 0;
    this.baseHeight = 0;
  }
}

