import type { Project3DModelSlotRole } from "@prisma/client";

import type { Project3DSceneNode } from "@/lib/3d/shared/contracts";
import { cleanGlbNodeName } from "@/lib/3d/shared/glbNodeName";

const UNIT_NODE_PATTERN = /^Unit_/i;

export type ValidationStatus = "ready" | "warning" | "blocked";

export interface GlbValidationResult {
  status: ValidationStatus;
  issues: string[];
  triangleCount: number | null;
  meshCount: number | null;
  materialCount: number | null;
  textureCount: number | null;
  unitNodeNames: string[];
  sceneManifest: Project3DSceneNode[];
}

interface GltfAccessor {
  count?: number;
}
interface GltfPrimitive {
  indices?: number;
  mode?: number;
}
interface GltfMesh {
  primitives?: GltfPrimitive[];
}
interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
}
interface GltfJson {
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  meshes?: GltfMesh[];
  materials?: unknown[];
  images?: unknown[];
  nodes?: GltfNode[];
  accessors?: GltfAccessor[];
}

function slugifyNodeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "node";
}

export function buildSceneManifest(json: GltfJson): Project3DSceneNode[] {
  const nodes = json.nodes ?? [];
  const parentOf = new Map<number, number>();
  nodes.forEach((node, i) => {
    (node.children ?? []).forEach((childIndex) => parentOf.set(childIndex, i));
  });

  const ids = nodes.map((node, i) => `node_${i}_${slugifyNodeName(cleanGlbNodeName(node.name || `node${i}`))}`);

  function depthOf(index: number, guard = 0): number {
    const parent = parentOf.get(index);
    if (parent == null || guard > nodes.length) return 0;
    return 1 + depthOf(parent, guard + 1);
  }

  return nodes.map((node, i) => {
    const parent = parentOf.get(i);
    const name = cleanGlbNodeName(node.name || `Node ${i}`);
    return {
      nodeId: ids[i],
      name,
      meshIndex: node.mesh ?? null,
      parentNodeId: parent != null ? ids[parent] : null,
      depth: depthOf(i),
      isMesh: node.mesh != null,
      autoClassification: UNIT_NODE_PATTERN.test(name) ? "unit_block" : "architecture",
    };
  });
}

/** Required extensions three.js cannot load in this viewer (no KTX2Loader is configured). */
const VIEWER_UNSUPPORTED_EXTENSIONS = new Set(["KHR_texture_basisu"]);

const GLB_MAGIC = 0x46546c67;
const CHUNK_TYPE_JSON = 0x4e4f534a;

export const VALIDATION_THRESHOLDS = {
  mapModel: { warnTriangles: 150_000, blockTriangles: 500_000 },
  detailModel: { warnTriangles: 800_000, blockTriangles: 2_000_000 },
} as const;

export type ModelKind = keyof typeof VALIDATION_THRESHOLDS;

export const UNITS_SLOT_TRIANGLE_THRESHOLDS = { warnTriangles: 100_000, blockTriangles: 250_000 } as const;

export function parseGlbJsonChunk(buffer: ArrayBuffer): GltfJson {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20) throw new Error("File too small to be a valid GLB.");
  const magic = view.getUint32(0, true);
  if (magic !== GLB_MAGIC) throw new Error("Not a GLB file (bad magic bytes).");
  if (view.getUint32(4, true) !== 2) throw new Error("Only GLB 2.0 models are supported.");
  const totalLength = view.getUint32(8, true);
  if (totalLength !== buffer.byteLength) throw new Error("GLB header length does not match file size.");

  const chunkLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== CHUNK_TYPE_JSON) throw new Error("First GLB chunk isn't JSON.");
  // Bounds only: an unpadded chunk breaks the spec's alignment but three.js still reads it.
  if (chunkLength === 0 || chunkLength > buffer.byteLength - 20) throw new Error("Invalid GLB JSON chunk length.");
  const jsonBytes = new Uint8Array(buffer, 20, chunkLength);
  const jsonText = new TextDecoder("utf-8").decode(jsonBytes);
  return JSON.parse(jsonText) as GltfJson;
}

export async function validateGlb(
  buffer: ArrayBuffer,
  kind: ModelKind,
  slotRole?: Project3DModelSlotRole
): Promise<GlbValidationResult> {
  const issues: string[] = [];
  let json: GltfJson;
  try {
    json = parseGlbJsonChunk(buffer);
  } catch (e) {
    return {
      status: "blocked",
      issues: [(e as Error).message],
      triangleCount: null,
      meshCount: null,
      materialCount: null,
      textureCount: null,
      unitNodeNames: [],
      sceneManifest: [],
    };
  }

  const meshCount = json.meshes?.length ?? 0;
  const materialCount = json.materials?.length ?? 0;
  const textureCount = json.images?.length ?? 0;

  let triangleCount = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      if (prim.mode != null && prim.mode !== 4) continue;
      const accessor = prim.indices != null ? json.accessors?.[prim.indices] : undefined;
      if (accessor?.count != null) triangleCount += Math.floor(accessor.count / 3);
    }
  }

  const unitNodeNames = Array.from(
    new Set(
      (json.nodes ?? [])
        .map((n) => n.name)
        .filter((n): n is string => !!n)
        .map((n) => cleanGlbNodeName(n))
        .filter((n) => UNIT_NODE_PATTERN.test(n))
    )
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  if (meshCount === 0) issues.push("No meshes found in the GLB.");

  // The viewer decodes Draco and Meshopt geometry but has no KTX2 transcoder,
  // and three.js refuses a model that requires one rather than skipping it.
  const unloadable = (json.extensionsRequired ?? []).filter((name) => VIEWER_UNSUPPORTED_EXTENSIONS.has(name));
  if (unloadable.length > 0) {
    issues.push(`This model requires ${unloadable.join(", ")} (KTX2/Basis textures), which the 3D viewer cannot load. Export it again with PNG, JPEG or WebP textures.`);
  }

  const isUnitsSlot = kind === "detailModel" && slotRole === "UNITS";
  const { warnTriangles, blockTriangles } = isUnitsSlot ? UNITS_SLOT_TRIANGLE_THRESHOLDS : VALIDATION_THRESHOLDS[kind];
  const consequence =
    kind === "mapModel"
      ? "may render slowly and feel laggy while dragging or rotating the map"
      : "may render slowly and feel laggy while orbiting the 3D viewer";
  if (triangleCount > blockTriangles) {
    issues.push(
      isUnitsSlot
        ? `Triangle count ${triangleCount.toLocaleString()} exceeds the ${blockTriangles.toLocaleString()} block threshold for a Units slot — interaction volumes should be simple boxes (recommended under 50,000 total), not detailed geometry.`
        : `Triangle count ${triangleCount.toLocaleString()} exceeds the ${blockTriangles.toLocaleString()} block threshold for this pipeline — too heavy to publish, ${consequence}.`
    );
  } else if (triangleCount > warnTriangles) {
    issues.push(`Triangle count ${triangleCount.toLocaleString()} exceeds the ${warnTriangles.toLocaleString()} recommended limit — ${consequence}. Consider simplifying the model before publishing.`);
  }

  const sceneManifest = kind === "detailModel" ? buildSceneManifest(json) : [];

  let blockingDuplicateUnitNames = false;
  if (kind === "detailModel") {
    const nameCounts = new Map<string, number>();
    for (const n of sceneManifest) nameCounts.set(n.name, (nameCounts.get(n.name) ?? 0) + 1);
    const duplicates = Array.from(nameCounts.entries()).filter(([, count]) => count > 1);
    if (duplicates.length > 0) {
      const sample = duplicates
        .slice(0, 5)
        .map(([name, count]) => `"${name}" (×${count})`)
        .join(", ");
      const duplicateUnitNames = duplicates.filter(([name]) => UNIT_NODE_PATTERN.test(name));
      if (isUnitsSlot && duplicateUnitNames.length > 0) {
        blockingDuplicateUnitNames = true;
        issues.push(
          `${duplicateUnitNames.length} unit block name${duplicateUnitNames.length === 1 ? "" : "s"} used more than once in this Units GLB (${duplicateUnitNames.map(([name, count]) => `"${name}" (×${count})`).join(", ")}) — each unit must have a uniquely-named node. Rename before publishing.`
        );
      } else {
        issues.push(
          `${duplicates.length} node name${duplicates.length === 1 ? "" : "s"} used more than once (${sample}${duplicates.length > 5 ? ", …" : ""}) — material overrides and unit links are matched by name, so a duplicate can silently apply to the wrong node. Consider renaming for clarity before linking units or setting overrides.`
        );
      }
    }

    const invalidUnitNames = unitNodeNames.filter((n) => !/[a-z0-9]/i.test(n.replace(/^unit_?/i, "")));
    if (isUnitsSlot && invalidUnitNames.length > 0) {
      issues.push(
        `${invalidUnitNames.length} node${invalidUnitNames.length === 1 ? "" : "s"} named just "Unit_" with no unit code after it (${invalidUnitNames.slice(0, 5).join(", ")}${invalidUnitNames.length > 5 ? ", …" : ""}) — rename to "Unit_<code>" (e.g. "Unit_A-101").`
      );
    }
  }

  let status: ValidationStatus = "ready";
  if (meshCount === 0 || triangleCount > blockTriangles || blockingDuplicateUnitNames || unloadable.length > 0) status = "blocked";
  else if (issues.length > 0) status = "warning";

  return { status, issues, triangleCount, meshCount, materialCount, textureCount, unitNodeNames, sceneManifest };
}
