import * as THREE from "three/webgpu";
import { LineSegments2 } from "three/examples/jsm/lines/webgpu/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { Unit, UnitMeshLink, UnitsConfig } from "@/lib/3d/runtime/types";
import { unitSelectedFillColorNumber, unitSelectedOutlineColorNumber, unitStatusColorNumber } from "@/lib/3d/runtime/unitStatusVisuals";
import { cleanGlbNodeName } from "@/lib/3d/shared/glbNodeName";
import { clipSegmentsToPlanes, planesSignature } from "./sections";

const UNIT_NODE_PATTERN = /^Unit_/i;

class UnclippedLine2NodeMaterial extends THREE.Line2NodeMaterial {
  setupClipping(): ReturnType<THREE.Line2NodeMaterial["setupClipping"]> {
    return null as unknown as ReturnType<THREE.Line2NodeMaterial["setupClipping"]>;
  }

  setupHardwareClipping(builder: Parameters<THREE.Line2NodeMaterial["setupHardwareClipping"]>[0]): void {
    (builder as unknown as { hardwareClipping: boolean }).hardwareClipping = false;
  }
}

export interface UnitRuntimeEntry {
  unitId: string;
  unitCode: string;
  status: Unit["status"];
  rootObject: THREE.Object3D;
  meshes: THREE.Mesh[];
  worldBounds: THREE.Box3;
  worldCenter: THREE.Vector3;
  worldBoundingSphere: THREE.Sphere;
  poiYawDeg: number;
  poiYawAuthored: boolean;
  poiEnabled: boolean;
  poiDistanceOverride: number | null;
  poiHeightOverride: number | null;
}

export function findUnitRootObjects(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const roots = new Map<string, THREE.Object3D>();
  function walk(node: THREE.Object3D) {
    const name = cleanGlbNodeName(node.name);
    if (UNIT_NODE_PATTERN.test(name)) {
      if (!roots.has(name)) roots.set(name, node);
      return;
    }
    for (const child of node.children) walk(child);
  }
  walk(root);
  return roots;
}

function collectMeshes(node: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  function walk(current: THREE.Object3D) {
    if (current.userData.isUnitOutline) return;
    if ((current as THREE.Mesh).isMesh) meshes.push(current as THREE.Mesh);
    for (const child of current.children) walk(child);
  }
  walk(node);
  return meshes;
}

function derivedYawDeg(worldCenter: THREE.Vector3, sceneCenter: THREE.Vector3 | null): number {
  if (!sceneCenter) return 0;
  const dx = worldCenter.x - sceneCenter.x;
  const dz = worldCenter.z - sceneCenter.z;
  if (dx * dx + dz * dz < 1e-6) return 0;
  return (Math.atan2(dx, dz) * 180) / Math.PI;
}

export function buildUnitRegistry(
  rootObjectsByName: Map<string, THREE.Object3D>,
  unitLinks: UnitMeshLink[],
  unitsById: Map<string, Unit>,
  poiByUnitId: Map<
    string,
    { poiYawDeg: number | null; poiEnabled: boolean; poiDistanceOverride: number | null; poiHeightOverride: number | null }
  >,
  sceneCenter: THREE.Vector3 | null = null
): Map<string, UnitRuntimeEntry> {
  const registry = new Map<string, UnitRuntimeEntry>();
  for (const link of unitLinks) {
    const rootObject = rootObjectsByName.get(link.meshName);
    const unit = unitsById.get(link.unitId);
    if (!rootObject || !unit) continue;
    const worldBounds = new THREE.Box3().setFromObject(rootObject);
    const worldCenter = worldBounds.getCenter(new THREE.Vector3());
    const worldBoundingSphere = worldBounds.getBoundingSphere(new THREE.Sphere());
    const poi = poiByUnitId.get(unit.id);
    const authoredYaw = poi?.poiYawDeg ?? null;
    const yawAimed = authoredYaw != null && authoredYaw !== 0;
    registry.set(unit.id, {
      unitId: unit.id,
      unitCode: unit.code,
      status: unit.status,
      rootObject,
      meshes: collectMeshes(rootObject),
      worldBounds,
      worldCenter,
      worldBoundingSphere,
      poiYawDeg: yawAimed ? authoredYaw : derivedYawDeg(worldCenter, sceneCenter),
      poiYawAuthored: yawAimed,
      poiEnabled: poi?.poiEnabled ?? true,
      poiDistanceOverride: poi?.poiDistanceOverride ?? null,
      poiHeightOverride: poi?.poiHeightOverride ?? null,
    });
  }
  return registry;
}

export type UnitBoxAppearanceConfig = Pick<
  UnitsConfig,
  | "unitBlocksEnabled"
  | "unitBlocksStatusColorsEnabled"
  | "unitBlocksXrayEnabled"
  | "unitBlocksDefaultOpacity"
  | "unitBlocksHoverOpacity"
  | "unitBlocksSelectedOpacity"
  | "unitBlocksSelectedOutlineEnabled"
  | "unitBlocksSelectedOutlineWidth"
  | "unitBlocksSelectedScaleEnabled"
  | "unitBlocksSelectedScale"
  | "unitBlocksSelectedFillEnabled"
  | "unitColorSelectedFill"
  | "unitBlocksSelectedXrayEnabled"
  | "unitColorAvailable"
  | "unitColorReserved"
  | "unitColorSold"
  | "unitColorSelected"
>;

function materialCacheKey(color: number, opacity: number, depthTest: boolean): string {
  return `${color}|${opacity}|${depthTest}`;
}

function outlineWidthPx(config: Pick<UnitBoxAppearanceConfig, "unitBlocksSelectedOutlineWidth">): number {
  const width = config.unitBlocksSelectedOutlineWidth;
  if (!Number.isFinite(width)) return 1;
  return Math.min(20, Math.max(0.5, width));
}

export function applyUnitBoxAppearance(
  rootObjectsByName: Map<string, THREE.Object3D>,
  unitLinks: UnitMeshLink[],
  unitsById: Map<string, Unit>,
  statusColorsAllowed: boolean,
  selectedUnitId: string | null,
  hoveredUnitId: string | null,
  config: UnitBoxAppearanceConfig,
  originalMaterials: WeakMap<THREE.Mesh, THREE.Material[]>,
  materialCache: Map<string, THREE.MeshBasicMaterial>,
  outlineByMesh: Map<THREE.Mesh, LineSegments2>
): THREE.Mesh[] {
  const linkByMesh = new Map(unitLinks.map((l) => [l.meshName, l.unitId]));
  const raycastTargets: THREE.Mesh[] = [];
  const statusColorsEnabled = statusColorsAllowed && config.unitBlocksStatusColorsEnabled;

  function normalizeMaterials(m: THREE.Material | THREE.Material[]): THREE.Material[] {
    return Array.isArray(m) ? m : [m];
  }

  function clearOutline(mesh: THREE.Mesh) {
    const outline = outlineByMesh.get(mesh);
    if (!outline) return;
    mesh.remove(outline);
    outline.geometry.dispose();
    (outline.material as THREE.Material).dispose();
    outlineByMesh.delete(mesh);
  }

  for (const [meshName, rootObject] of rootObjectsByName) {
    const linkedUnitId = linkByMesh.get(meshName);
    const unit = config.unitBlocksEnabled ? unitsById.get(linkedUnitId ?? "") : undefined;
    const isSelected = selectedUnitId != null && linkedUnitId === selectedUnitId;
    const isHovered = hoveredUnitId != null && linkedUnitId === hoveredUnitId;

    for (const mesh of collectMeshes(rootObject)) {
      if (!originalMaterials.has(mesh)) {
        originalMaterials.set(mesh, normalizeMaterials(mesh.material));
      }
      const originals = originalMaterials.get(mesh)!;
      mesh.castShadow = false;
      mesh.receiveShadow = false;

      if (unit && linkedUnitId) {
        mesh.userData.isUnitBlock = true;
        mesh.userData.unitRootName = meshName;
        mesh.userData.unitId = linkedUnitId;
        if (config.unitBlocksEnabled) raycastTargets.push(mesh);
      } else {
        delete mesh.userData.isUnitBlock;
        delete mesh.userData.unitRootName;
        delete mesh.userData.unitId;
      }

      const currentIsOriginal = normalizeMaterials(mesh.material).every((m, i) => m === originals[i]);
      const showTint = !!unit && (statusColorsEnabled || isSelected || isHovered);

      if (!showTint) {
        if (!currentIsOriginal) {
          normalizeMaterials(mesh.material).forEach((m) => m.dispose());
          mesh.material = originals.length === 1 ? originals[0] : originals;
        }
        clearOutline(mesh);
        continue;
      }

      const color =
        isSelected && config.unitBlocksSelectedFillEnabled
          ? unitSelectedFillColorNumber(config)
          : unitStatusColorNumber(unit!.status, config);
      const opacity = isSelected
        ? config.unitBlocksSelectedOpacity
        : isHovered
          ? config.unitBlocksHoverOpacity
          : config.unitBlocksDefaultOpacity;
      const depthTest = !(config.unitBlocksXrayEnabled || (isSelected && config.unitBlocksSelectedXrayEnabled));
      const key = materialCacheKey(color, opacity, depthTest);
      let material = materialCache.get(key);
      if (!material) {
        material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest });
        materialCache.set(key, material);
      }
      if (!currentIsOriginal && mesh.material !== material) {
        normalizeMaterials(mesh.material).forEach((m) => {
          if (m !== material) m.dispose();
        });
      }
      mesh.material = material;

      if (isSelected && config.unitBlocksSelectedOutlineEnabled) {
        let outline = outlineByMesh.get(mesh);
        const outlineColor = unitSelectedOutlineColorNumber(config);
        const linewidth = outlineWidthPx(config);
        if (!outline) {
          const edges = new THREE.EdgesGeometry(mesh.geometry);
          const geometry = new LineSegmentsGeometry().fromEdgesGeometry(edges);
          const basePositions = Array.from(edges.attributes.position.array as ArrayLike<number>);
          edges.dispose();
          const material = new UnclippedLine2NodeMaterial({ color: outlineColor });
          material.linewidth = linewidth;
          material.depthTest = depthTest;
          material.polygonOffset = true;
          material.polygonOffsetFactor = -2;
          material.polygonOffsetUnits = -2;
          outline = new LineSegments2(geometry, material);
          outline.userData.isUnitOutline = true;
          outline.userData.basePositions = basePositions;
          outline.renderOrder = mesh.renderOrder + 1;
          mesh.add(outline);
          outlineByMesh.set(mesh, outline);
        } else {
          outline.material.color.setHex(outlineColor);
          outline.material.linewidth = linewidth;
          outline.material.depthTest = depthTest;
        }
      } else {
        clearOutline(mesh);
      }
    }
  }

  return raycastTargets;
}

interface ClipState {
  section: string;
  matrix: number[];
}

function matrixMatches(elements: number[], matrix: THREE.Matrix4): boolean {
  const live = matrix.elements;
  for (let i = 0; i < 16; i++) if (elements[i] !== live[i]) return false;
  return true;
}

export function clipUnitOutlinesState(
  outlineByMesh: Map<THREE.Mesh, LineSegments2>,
  planes: THREE.Plane[] | null
): string {
  if (outlineByMesh.size === 0) return planes ? "cut, no selection" : "no selection";
  let base = 0;
  let live = 0;
  let outside = 0;
  const worldPoint = new THREE.Vector3();
  for (const [mesh, outline] of outlineByMesh) {
    base += ((outline.userData.basePositions as number[] | undefined)?.length ?? 0) / 6;
    const attribute = outline.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute | undefined;
    if (!attribute) continue;
    live += attribute.count;
    if (!planes || !outline.visible) continue;
    const points = attribute.data.array;
    mesh.updateWorldMatrix(true, false);
    for (let i = 0; i + 2 < points.length; i += 3) {
      worldPoint.set(points[i], points[i + 1], points[i + 2]).applyMatrix4(mesh.matrixWorld);
      if (planes.some((plane) => plane.distanceToPoint(worldPoint) < -1e-3)) outside++;
    }
  }
  if (!planes) return `${live} segs, no cut`;
  return `${live}/${base} segs cut${outside > 0 ? ` — ${outside} outside` : ""}`;
}

export function clipUnitOutlinesToSection(
  outlineByMesh: Map<THREE.Mesh, LineSegments2>,
  planes: THREE.Plane[] | null
) {
  if (outlineByMesh.size === 0) return;
  const sectionSignature = planes ? planesSignature(planes) : "none";
  const worldPoint = new THREE.Vector3();
  for (const [mesh, outline] of outlineByMesh) {
    const base = outline.userData.basePositions as number[] | undefined;
    if (!base) continue;
    mesh.updateWorldMatrix(true, false);
    const state = outline.userData.clipState as ClipState | undefined;
    if (state && state.section === sectionSignature && matrixMatches(state.matrix, mesh.matrixWorld)) continue;
    outline.userData.clipState = {
      section: sectionSignature,
      matrix: [...mesh.matrixWorld.elements],
    } satisfies ClipState;

    if (!planes) {
      outline.geometry.setPositions(base);
      outline.visible = true;
      continue;
    }

    const toWorld = mesh.matrixWorld;
    const toLocal = toWorld.clone().invert();
    const world: number[] = new Array(base.length);
    for (let i = 0; i + 2 < base.length; i += 3) {
      worldPoint.set(base[i], base[i + 1], base[i + 2]).applyMatrix4(toWorld);
      world[i] = worldPoint.x;
      world[i + 1] = worldPoint.y;
      world[i + 2] = worldPoint.z;
    }
    const clipped = clipSegmentsToPlanes(world, planes);
    if (clipped.length === 0) {
      outline.visible = false;
      continue;
    }
    for (let i = 0; i + 2 < clipped.length; i += 3) {
      worldPoint.set(clipped[i], clipped[i + 1], clipped[i + 2]).applyMatrix4(toLocal);
      clipped[i] = worldPoint.x;
      clipped[i + 1] = worldPoint.y;
      clipped[i + 2] = worldPoint.z;
    }
    outline.geometry.setPositions(clipped);
    outline.visible = true;
  }
}

export type UnitSelectionScaleOriginals = Map<
  THREE.Object3D,
  { position: THREE.Vector3; scale: THREE.Vector3 }
>;

export function clearUnitSelectionScale(originals: UnitSelectionScaleOriginals) {
  for (const [object, transform] of originals) {
    object.position.copy(transform.position);
    object.scale.copy(transform.scale);
    object.updateMatrix();
  }
  originals.clear();
}

export function applyUnitSelectionScale(
  rootObject: THREE.Object3D,
  scale: number,
  originals: UnitSelectionScaleOriginals
) {
  if (!Number.isFinite(scale)) return;
  const clamped = Math.min(1.5, Math.max(1, scale));
  if (clamped === 1) return;
  if (originals.has(rootObject)) return;

  rootObject.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(rootObject);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  if (rootObject.parent) rootObject.parent.worldToLocal(center);

  originals.set(rootObject, { position: rootObject.position.clone(), scale: rootObject.scale.clone() });
  rootObject.scale.multiplyScalar(clamped);
  rootObject.position.lerp(center, 1 - clamped);
  rootObject.updateMatrix();
}

export function disposeUnitBoxAppearanceCaches(
  materialCache: Map<string, THREE.MeshBasicMaterial>,
  outlineByMesh: Map<THREE.Mesh, LineSegments2>
) {
  for (const material of materialCache.values()) material.dispose();
  materialCache.clear();
  for (const outline of outlineByMesh.values()) {
    outline.geometry.dispose();
    (outline.material as THREE.Material).dispose();
  }
  outlineByMesh.clear();
}

