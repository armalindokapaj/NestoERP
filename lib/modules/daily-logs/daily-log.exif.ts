/**
 * Location metadata out of site photos (PRD #43 §83).
 *
 * A phone photo carries where it was taken in its EXIF block, and the original
 * file is what storage keeps and what a download returns. So before a JPEG
 * leaves the browser for a daily log, the metadata segments are removed: APP1
 * (EXIF and XMP, where GPS lives) and APP13 (IPTC). The image data itself is
 * copied byte for byte — nothing is re-encoded, so nothing is lost.
 *
 * Pure and client-safe. Anything that is not a well-formed JPEG comes back
 * unchanged rather than half-edited.
 */

const SOI = 0xd8;
const SOS = 0xda;
const EOI = 0xd9;
const STRIPPED = new Set([0xe1, 0xed]);

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === SOI;
}

export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (!isJpeg(bytes)) return bytes;
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return bytes;
    const marker = bytes[offset + 1];
    // Fill bytes between segments.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === EOI) {
      kept.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      break;
    }
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return bytes;
    const end = offset + 2 + length;
    if (marker === SOS) {
      // The scan runs to the end of the file: keep all of it.
      kept.push(bytes.subarray(offset));
      offset = bytes.length;
      break;
    }
    if (!STRIPPED.has(marker)) kept.push(bytes.subarray(offset, end));
    offset = end;
  }
  if (offset < bytes.length) kept.push(bytes.subarray(offset));
  const total = kept.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let position = 0;
  for (const part of kept) {
    result.set(part, position);
    position += part.length;
  }
  return result;
}

/** Whether an APP1 EXIF segment is present — used by tests and upload checks. */
export function hasExif(bytes: Uint8Array): boolean {
  if (!isJpeg(bytes)) return false;
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === SOS || marker === EOI) return false;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xe1 && bytes[offset + 4] === 0x45 && bytes[offset + 5] === 0x78 && bytes[offset + 6] === 0x69 && bytes[offset + 7] === 0x66) return true;
    offset += 2 + length;
  }
  return false;
}
