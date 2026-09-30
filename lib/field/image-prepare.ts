import { isJpeg, stripJpegMetadata } from "@/lib/modules/daily-logs/daily-log.exif";

/**
 * Prepares a phone photo for upload (MOB-07 §31-§33, §95).
 *
 * - A large JPEG is re-encoded at a long edge of at most 3200px and quality 0.9
 *   — plenty for construction evidence, a fraction of the 8-12 MB a camera
 *   writes. The browser applies the EXIF orientation while decoding, so the
 *   picture stays upright, and the re-encode carries no EXIF/GPS (§33, §34).
 * - A small JPEG, or one that would not get smaller, keeps its pixels and only
 *   loses its location metadata (byte-for-byte segment removal).
 * - Anything that is not a JPEG (PNG screenshots, drawings, text) is never
 *   touched: no lossy pass over text until it is unreadable (§31).
 * - Decoding uses `createImageBitmap`, which does not block the main thread
 *   (§95); where it is missing the file goes through unchanged.
 *
 * The original is not kept here. Where an evidence policy needs the untouched
 * original, call sites pass `{ keepOriginal: true }` and get the file back as
 * it was chosen (§32).
 */

const MAX_EDGE = 3200;
const QUALITY = 0.9;
/** Below this a re-encode is not worth the time. */
const RECOMPRESS_ABOVE_BYTES = 1.5 * 1024 * 1024;

export async function prepareImage(file: File, options: { keepOriginal?: boolean } = {}): Promise<File> {
  if (options.keepOriginal) return file;
  if (file.type !== "image/jpeg" && !/\.jpe?g$/i.test(file.name)) return file;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isJpeg(bytes)) return file;

    if (file.size > RECOMPRESS_ABOVE_BYTES && typeof createImageBitmap === "function") {
      const reduced = await reencode(file);
      if (reduced && reduced.size < file.size) return reduced;
    }

    const stripped = stripJpegMetadata(bytes);
    if (stripped.length === bytes.length) return file;
    return new File([stripped as BlobPart], file.name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

async function reencode(file: File): Promise<File | null> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    let blob: Blob | null;
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
      blob = await canvas.convertToBlob({ type: "image/jpeg", quality: QUALITY });
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    }
    return blob ? new File([blob], file.name.replace(/\.jpeg$/i, ".jpg"), { type: "image/jpeg", lastModified: file.lastModified }) : null;
  } finally {
    bitmap.close();
  }
}
