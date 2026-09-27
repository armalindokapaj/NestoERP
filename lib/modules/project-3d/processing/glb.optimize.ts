import type { Document } from "@gltf-transform/core";
import { parseGlbJsonChunk } from "./glb.validate";

// Lossless passes always run; texture re-encode is opt-in because it changes
// image data and needs a real look in the viewer. See scripts/optimize-blob-assets.ts.
export interface OptimizeOptions {
  textures?: boolean;
  textureQuality?: number;
  textureMaxSize?: number;
}

export interface OptimizeReport {
  inputBytes: number;
  outputBytes: number;
  textureCount: number;
  meshCount: number;
  texturesCompressed: boolean;
  texturesSkippedReason?: string;
  geometryPreservedReason?: string;
}

export interface OptimizeResult {
  bytes: Uint8Array;
  report: OptimizeReport;
}

export async function optimizeGlbForDeliveryDetailed(
  buffer: ArrayBuffer,
  options: OptimizeOptions = {}
): Promise<OptimizeResult> {
  const json = parseGlbJsonChunk(buffer);
  const compression = [...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])]
    .find((name) => name === "KHR_draco_mesh_compression" || name === "EXT_meshopt_compression");
  // These formats already have compressed geometry. Our browser loader decodes
  // them, but NodeIO has no corresponding decoder/encoder dependencies. Keep
  // their bytes intact instead of failing upload or expanding them for delivery.
  if (compression) {
    return {
      bytes: new Uint8Array(buffer),
      report: {
        inputBytes: buffer.byteLength, outputBytes: buffer.byteLength,
        textureCount: json.images?.length ?? 0, meshCount: json.meshes?.length ?? 0,
        texturesCompressed: false, texturesSkippedReason: "Already-compressed model preserved",
        geometryPreservedReason: compression,
      },
    };
  }
  // Do NOT hoist these to static imports. @gltf-transform/core is dual CJS/ESM;
  // a static import here resolves the CJS copy while `functions` resolves the ESM
  // one, and Document.fromGraph() then returns null across the two instances —
  // textureCompress dies with "Cannot read properties of null (reading 'getRoot')".
  const [core, functions, extensions] = await Promise.all([
    import("@gltf-transform/core"),
    import("@gltf-transform/functions"),
    import("@gltf-transform/extensions"),
  ]);

  // registerExtensions is load-bearing: without it the writer silently drops
  // EXT_texture_webp (producing WebP bytes no browser can decode) and reading
  // discards any extension the source GLB legitimately uses.
  const io = new core.NodeIO().registerExtensions(extensions.ALL_EXTENSIONS);
  const document = await io.readBinary(new Uint8Array(buffer));
  const root = document.getRoot();
  const textureCount = root.listTextures().length;
  const meshCount = root.listMeshes().length;

  await document.transform(functions.dedup(), functions.weld(), functions.prune());

  let texturesCompressed = false;
  let texturesSkippedReason: string | undefined = options.textures ? undefined : "not requested";

  if (options.textures) {
    try {
      await compressTextures(document, functions, options);
      texturesCompressed = true;
    } catch (err) {
      texturesSkippedReason = (err as Error).message;
    }
  }

  const candidate = await io.writeBinary(document);
  // Optimization should never make delivery heavier than the source.
  const bytes = candidate.byteLength < buffer.byteLength ? candidate : new Uint8Array(buffer);
  if (bytes !== candidate && texturesCompressed) {
    texturesCompressed = false;
    texturesSkippedReason = "Optimized output was not smaller than the source";
  }
  return {
    bytes,
    report: {
      inputBytes: buffer.byteLength,
      outputBytes: bytes.byteLength,
      textureCount,
      meshCount,
      texturesCompressed,
      texturesSkippedReason,
    },
  };
}

async function compressTextures(
  document: Document,
  functions: typeof import("@gltf-transform/functions"),
  options: OptimizeOptions
) {
  const sharpModule = await import("sharp");
  const encoder = sharpModule.default ?? (sharpModule as unknown as typeof sharpModule.default);

  await document.transform(
    functions.textureCompress({
      encoder,
      targetFormat: "webp",
      quality: options.textureQuality ?? 85,
      ...(options.textureMaxSize
        ? { resize: [options.textureMaxSize, options.textureMaxSize] as [number, number] }
        : {}),
    })
  );
}

export async function optimizeGlbForDelivery(buffer: ArrayBuffer): Promise<Uint8Array> {
  const { bytes } = await optimizeGlbForDeliveryDetailed(buffer);
  return bytes;
}
