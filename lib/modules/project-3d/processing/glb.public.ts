import type { Project3DSceneNode } from "@/lib/3d/shared/contracts";
import { cleanGlbNodeName } from "@/lib/3d/shared/glbNodeName";
import { buildSceneManifest, parseGlbJsonChunk } from "./glb.validate";

/**
 * The public delivery artifact of a runtime GLB (ADM-04A §7, EV-11).
 *
 * A model's bytes can carry what its author never meant to publish: node and
 * mesh names from a CAD layer tree, `extras`, generator and copyright strings,
 * XMP metadata, texture file names, and EXIF/text chunks inside embedded
 * images. This rewrites every name to a release-local opaque one — keeping the
 * `Unit_` and `Glass_` prefixes the renderer reads — removes the rest, strips
 * image metadata, and then reads its own output back to prove it.
 *
 * Anything it cannot sanitize blocks public readiness; it never falls back to
 * the private artifact.
 */

export class PublicSanitizeError extends Error {}

/** The prefixes the viewer's behaviour depends on (unit blocks, glass shadows). */
function behaviourPrefix(rawName: string): string {
  const name = cleanGlbNodeName(rawName);
  if (/^Unit_/i.test(name)) return "Unit_";
  if (/^Glass_/i.test(name)) return "Glass_";
  return "";
}

/* -------------------------------------------------------------------------- */
/* Embedded image metadata                                                    */
/* -------------------------------------------------------------------------- */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Chunks that affect how the image looks; every text, time, EXIF and profile chunk goes. */
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "bKGD"]);

export function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 8 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) throw new PublicSanitizeError("An embedded PNG is malformed.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const end = offset + 12 + length;
    if (end > bytes.length) throw new PublicSanitizeError("An embedded PNG is truncated.");
    if (PNG_KEEP.has(type)) parts.push(bytes.subarray(offset, end));
    offset = end;
    if (type === "IEND") break;
  }
  return concat(parts);
}

export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new PublicSanitizeError("An embedded JPEG is malformed.");
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) throw new PublicSanitizeError("An embedded JPEG is malformed.");
    const marker = bytes[offset + 1];
    // Start of scan: the entropy-coded data and everything after it are image data.
    if (marker === 0xda) {
      parts.push(bytes.subarray(offset));
      return concat(parts);
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) throw new PublicSanitizeError("An embedded JPEG is truncated.");
    // APP1–APP13 and APP15 (EXIF, XMP, IPTC, ICC, vendor data) and comments go;
    // APP0 (JFIF) and APP14 (Adobe colour transform) change how it decodes, so they stay.
    const drop = (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe;
    if (!drop) parts.push(bytes.subarray(offset, end));
    offset = end;
  }
  throw new PublicSanitizeError("An embedded JPEG has no image data.");
}

export function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WEBP") throw new PublicSanitizeError("An embedded WebP is malformed.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Uint8Array[] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const fourcc = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size + (size % 2);
    if (offset + 8 + size > bytes.length) throw new PublicSanitizeError("An embedded WebP is truncated.");
    if (!["EXIF", "XMP ", "ICCP"].includes(fourcc)) {
      const chunk = bytes.slice(offset, Math.min(end, bytes.length));
      // VP8X flags announce ICC, EXIF and XMP chunks that are no longer there.
      if (fourcc === "VP8X") chunk[8] &= ~(0x20 | 0x08 | 0x04);
      chunks.push(chunk);
    }
    offset = end;
  }
  const body = concat(chunks);
  const out = new Uint8Array(12 + body.length);
  out.set(bytes.subarray(0, 12));
  new DataView(out.buffer).setUint32(4, 4 + body.length, true);
  out.set(body, 12);
  return out;
}

export function stripImageMetadata(bytes: Uint8Array, mimeType: string): Uint8Array {
  if (mimeType === "image/png") return stripPngMetadata(bytes);
  if (mimeType === "image/jpeg") return stripJpegMetadata(bytes);
  if (mimeType === "image/webp") return stripWebpMetadata(bytes);
  throw new PublicSanitizeError(`Embedded ${mimeType || "unknown"} textures cannot be sanitized for public delivery yet.`);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The GLB                                                                     */
/* -------------------------------------------------------------------------- */

export type PublicGlb = {
  bytes: Uint8Array;
  /** The rewritten scene, as the viewer will read it. */
  sceneManifest: Project3DSceneNode[];
  /** Internal nodeId → public nodeId, for carrying node overrides across. */
  nodeIds: Map<string, string>;
  /** Internal (cleaned) node name → public name, for carrying unit bindings across. */
  names: Map<string, string>;
};

/** Where any text could survive a rename, as a JSON walk of the output proves. */
function findLeaks(json: unknown, path = "$", leaks: string[] = []): string[] {
  if (Array.isArray(json)) json.forEach((item, index) => findLeaks(item, `${path}[${index}]`, leaks));
  else if (json && typeof json === "object") {
    for (const [key, value] of Object.entries(json)) {
      if (key === "extras" || key === "copyright" || key === "KHR_xmp_json_ld") leaks.push(`${path}.${key}`);
      else if (key === "uri" && typeof value === "string" && !value.startsWith("data:")) leaks.push(`${path}.uri`);
      else if (key === "name" && typeof value === "string" && value !== "" && !/^(Unit_|Glass_)?[a-z]{1,4}\d{1,6}$/.test(value)) leaks.push(`${path}.name`);
      else findLeaks(value, `${path}.${key}`, leaks);
    }
  }
  return leaks;
}

export async function sanitizeGlbForPublic(input: Uint8Array): Promise<PublicGlb> {
  const buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  const json = parseGlbJsonChunk(buffer);
  const extensions = [...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])];
  if (extensions.some((name) => name === "KHR_draco_mesh_compression" || name === "EXT_meshopt_compression")) {
    throw new PublicSanitizeError("This model uses compressed geometry, which cannot be rewritten for public delivery yet. Upload an uncompressed version.");
  }
  if (extensions.includes("KHR_texture_basisu")) throw new PublicSanitizeError("KTX2 textures cannot be sanitized for public delivery yet.");

  const [core, allExtensions] = await Promise.all([import("@gltf-transform/core"), import("@gltf-transform/extensions")]);
  const io = new core.NodeIO().registerExtensions(allExtensions.ALL_EXTENSIONS);
  const document = await io.readBinary(input);
  const root = document.getRoot();

  // Metadata that is not the model.
  for (const extension of root.listExtensionsUsed()) {
    if (extension.extensionName === "KHR_xmp_json_ld") extension.dispose();
  }
  root.getAsset().generator = "NESTO";
  delete root.getAsset().copyright;
  delete (root.getAsset() as { extras?: unknown }).extras;
  root.setExtras({});

  const before = buildSceneManifest(json as Parameters<typeof buildSceneManifest>[0]);
  const nodes = root.listNodes();
  if (nodes.length !== before.length) throw new PublicSanitizeError("The model's node list could not be read consistently.");
  nodes.forEach((node, index) => node.setName(`${behaviourPrefix(node.getName())}n${index}`).setExtras({}));
  root.listMeshes().forEach((mesh, index) => {
    mesh.setName(`${behaviourPrefix(mesh.getName())}m${index}`).setExtras({});
    mesh.listPrimitives().forEach((primitive) => primitive.setExtras({}));
  });
  root.listMaterials().forEach((material, index) => material.setName(`mat${index}`).setExtras({}));
  root.listScenes().forEach((scene, index) => scene.setName(`sc${index}`).setExtras({}));
  root.listAnimations().forEach((animation, index) => animation.setName(`an${index}`).setExtras({}));
  root.listSkins().forEach((skin, index) => skin.setName(`sk${index}`).setExtras({}));
  root.listCameras().forEach((camera, index) => camera.setName(`ca${index}`).setExtras({}));
  root.listAccessors().forEach((accessor) => accessor.setName("").setExtras({}));
  root.listBuffers().forEach((item) => item.setName("").setExtras({}));
  for (const texture of root.listTextures()) {
    const image = texture.getImage();
    if (image) texture.setImage(stripImageMetadata(image, texture.getMimeType()));
    texture.setName("").setURI("").setExtras({});
  }
  // Extension properties with their own names (lights, material variants).
  for (const extension of root.listExtensionsUsed()) {
    for (const property of (extension as unknown as { listProperties?: () => Array<{ setName?: (name: string) => unknown; setExtras?: (extras: object) => unknown }> }).listProperties?.() ?? []) {
      property.setName?.("");
      property.setExtras?.({});
    }
  }

  const bytes = await io.writeBinary(document);
  const out = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const outJson = parseGlbJsonChunk(out);
  const leaks = findLeaks(outJson);
  if (leaks.length > 0) throw new PublicSanitizeError(`Sanitizing left identifiable content in the model (${leaks.slice(0, 3).join(", ")}).`);

  const after = buildSceneManifest(outJson as Parameters<typeof buildSceneManifest>[0]);
  if (after.length !== before.length) throw new PublicSanitizeError("The rewritten model changed its node structure.");
  // The writer kept the node order: node i carries the name given to node i.
  if (after.some((node, index) => !node.name.endsWith(`n${index}`) || node.meshIndex !== before[index].meshIndex || node.depth !== before[index].depth)) {
    throw new PublicSanitizeError("The rewritten model changed its node order.");
  }
  const nodeIds = new Map<string, string>();
  const names = new Map<string, string>();
  before.forEach((node, index) => {
    nodeIds.set(node.nodeId, after[index].nodeId);
    if (!names.has(node.name)) names.set(node.name, after[index].name);
  });
  return { bytes, sceneManifest: after, nodeIds, names };
}
