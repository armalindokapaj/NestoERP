import * as THREE from "three/webgpu";
import type { Section } from "@/lib/3d/runtime/types";

const UP = new THREE.Vector3(0, 1, 0);
const MIN_FOOTPRINT_M = 1;
export const SECTION_MAX_DIMENSION_M = 5000;

export const SECTION_FOOTPRINT_MAX_M = 200;
export const SECTION_HEIGHT_STOPS_M = [0, 100, 350];
const BOTTOM_CLIP_Y = 0;
const FAR_M = 1_000_000;

function sectionAxes(rotationDeg: number): { right: THREE.Vector3; forward: THREE.Vector3 } {
  const rad = THREE.MathUtils.degToRad(rotationDeg);
  return {
    right: new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, rad),
    forward: new THREE.Vector3(0, 0, 1).applyAxisAngle(UP, rad),
  };
}

export function buildSectionPlanes(section: Section): THREE.Plane[] {
  const { right, left, front, back } = sideAnchors(section);
  const { right: rightAxis, forward: forwardAxis } = sectionAxes(section.rotationDeg);
  const center = new THREE.Vector3(section.centerX, section.heightM, section.centerZ);
  const heightOnly = !!section.heightOnly;

  return [
    heightOnly ? noClipPlane() : new THREE.Plane().setFromNormalAndCoplanarPoint(rightAxis.clone().negate(), right),
    heightOnly ? noClipPlane() : new THREE.Plane().setFromNormalAndCoplanarPoint(rightAxis.clone(), left),
    heightOnly ? noClipPlane() : new THREE.Plane().setFromNormalAndCoplanarPoint(forwardAxis.clone().negate(), front),
    heightOnly ? noClipPlane() : new THREE.Plane().setFromNormalAndCoplanarPoint(forwardAxis.clone(), back),
    new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, -1, 0), center),
    section.bottomEnabled
      ? new THREE.Plane().setFromNormalAndCoplanarPoint(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(section.centerX, BOTTOM_CLIP_Y, section.centerZ)
        )
      : noClipPlane(),
  ];
}

function noClipPlane(): THREE.Plane {
  return new THREE.Plane().setFromNormalAndCoplanarPoint(UP, new THREE.Vector3(0, -FAR_M, 0));
}

export const NO_ACTIVE_SECTION_PLANES: THREE.Plane[] = [
  noClipPlane(),
  noClipPlane(),
  noClipPlane(),
  noClipPlane(),
  noClipPlane(),
  noClipPlane(),
];

function sideAnchors(section: Section) {
  const { right: rightAxis, forward: forwardAxis } = sectionAxes(section.rotationDeg);
  const center = new THREE.Vector3(section.centerX, section.heightM, section.centerZ);
  const hw = section.widthM / 2;
  const hd = section.depthM / 2;
  return {
    right: center.clone().addScaledVector(rightAxis, hw),
    left: center.clone().addScaledVector(rightAxis, -hw),
    front: center.clone().addScaledVector(forwardAxis, hd),
    back: center.clone().addScaledVector(forwardAxis, -hd),
  };
}

export function buildSectionCapGeometry(section: Section): THREE.BufferGeometry {
  const size = section.heightOnly ? 2 * FAR_M : undefined;
  const geometry = new THREE.PlaneGeometry(size ?? section.widthM, size ?? section.depthM);
  geometry.rotateX(-Math.PI / 2);
  geometry.rotateY(THREE.MathUtils.degToRad(section.rotationDeg));
  geometry.translate(section.centerX, section.heightM, section.centerZ);
  return geometry;
}

export function clipSegmentsToPlanes(positions: ArrayLike<number>, planes: THREE.Plane[]): number[] {
  const out: number[] = [];
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  for (let i = 0; i + 5 < positions.length; i += 6) {
    p1.set(positions[i], positions[i + 1], positions[i + 2]);
    p2.set(positions[i + 3], positions[i + 4], positions[i + 5]);
    let tMin = 0;
    let tMax = 1;
    let dropped = false;
    for (const plane of planes) {
      const d1 = plane.distanceToPoint(p1);
      const d2 = plane.distanceToPoint(p2);
      const delta = d2 - d1;
      if (Math.abs(delta) < 1e-9) {
        if (d1 < 0) {
          dropped = true;
          break;
        }
        continue;
      }
      const t = -d1 / delta;
      if (delta > 0) tMin = Math.max(tMin, t);
      else tMax = Math.min(tMax, t);
      if (tMin > tMax) {
        dropped = true;
        break;
      }
    }
    if (dropped) continue;
    out.push(
      p1.x + (p2.x - p1.x) * tMin,
      p1.y + (p2.y - p1.y) * tMin,
      p1.z + (p2.z - p1.z) * tMin,
      p1.x + (p2.x - p1.x) * tMax,
      p1.y + (p2.y - p1.y) * tMax,
      p1.z + (p2.z - p1.z) * tMax
    );
  }
  return out;
}

export function planesSignature(planes: THREE.Plane[]): string {
  return planes
    .map((p) => `${p.normal.x.toFixed(4)},${p.normal.y.toFixed(4)},${p.normal.z.toFixed(4)},${p.constant.toFixed(4)}`)
    .join("|");
}

export function sectionFromDragPoints(
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  opts: { id: string; name: string; heightM: number; scope: Section["scope"]; buildingName?: string }
): Section {
  const centerX = (p1.x + p2.x) / 2;
  const centerZ = (p1.z + p2.z) / 2;
  const widthM = Math.max(MIN_FOOTPRINT_M, Math.abs(p2.x - p1.x));
  const depthM = Math.max(MIN_FOOTPRINT_M, Math.abs(p2.z - p1.z));
  return {
    id: opts.id,
    name: opts.name,
    scope: opts.scope,
    buildingName: opts.buildingName,
    centerX,
    centerZ,
    widthM,
    depthM,
    rotationDeg: 0,
    heightM: opts.heightM,
    bottomEnabled: false,
    fillGapsEnabled: false,
    fillColor: DEFAULT_FILL_COLOR,
  };
}

export const DEFAULT_FILL_COLOR = "#f2f2f2";
export const SECTION_INDICATOR_COLOR = "#6b55f5";

