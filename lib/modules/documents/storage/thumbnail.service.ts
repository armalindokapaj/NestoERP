import sharp from "sharp";

import type { UserContext } from "@/lib/context/types";
import { buildDerivedKey, StorageError } from "@/lib/core/storage";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { prisma } from "@/lib/database/prisma";
import { requireDownloadableDocument } from "./storage-access.service";

/**
 * Image thumbnails (PRD #29 §51, §237; E-05A §8, §44).
 *
 * PRD #29 left thumbnails out of V0.1, with the columns and the derived-key
 * layout waiting for them. The Projects page is the first surface that needs
 * one: a gallery of 24 architectural renders cannot download 24 originals.
 *
 * One derived object per document, 3:4 and wide enough for a card on a
 * high-density screen, built on first request and kept at the document's
 * derived `thumb` key. Promoting a new version clears `thumbnailStorageKey`
 * (version.promote.ts), so the next request rebuilds it over the old one.
 *
 * Authorisation is the download gate, unchanged: the same module, permission,
 * parent-record and object-state checks as the original file. A thumbnail is a
 * smaller copy of the same bytes and never a way around them (E-05A §73).
 *
 * Thumbnail reads are not audited individually. A gallery page would write one
 * event per card per visit, and a preview of a file the reader may already
 * download is not the disclosure the preview and download events exist to
 * record.
 */

export const THUMBNAIL_WIDTH = 600;
export const THUMBNAIL_HEIGHT = 800;
const THUMBNAIL_CONTENT_TYPE = "image/webp";

/** The formats a thumbnail is built from — the V0.1 inline-safe images (PRD #29 §45). */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Above this a render is refused rather than decoded: 50 megapixels is past any cover. */
const MAX_INPUT_PIXELS = 50_000_000;

export type Thumbnail = { body: Uint8Array; contentType: string; etag: string };

type AuthorizedThumbnailDocument = {
  id: string;
  updatedAt: Date;
  storageKey: string | null;
  thumbnailStorageKey: string | null;
  detectedMimeType: string | null;
  mimeType: string | null;
};

export function isThumbnailableMimeType(mimeType: string | null | undefined): boolean {
  return IMAGE_TYPES.has((mimeType ?? "").toLowerCase());
}

export async function readDocumentThumbnail(context: UserContext, documentId: string): Promise<Thumbnail> {
  const document = await requireDownloadableDocument(context, documentId);
  return readAuthorizedDocumentThumbnail(context.companyId, document);
}

/**
 * Builds or reads a thumbnail after a parent service has authorized the file.
 * This keeps project/unit media permissions at their own boundary without
 * duplicating image processing or weakening the normal Document download gate.
 */
export async function readAuthorizedDocumentThumbnail(
  companyId: string,
  document: AuthorizedThumbnailDocument,
): Promise<Thumbnail> {
  const mimeType = document.detectedMimeType ?? document.mimeType;
  if (!isThumbnailableMimeType(mimeType)) throw new StorageError("PREVIEW_NOT_SUPPORTED");
  if (!document.storageKey) throw new StorageError("STORAGE_OBJECT_MISSING");

  const provider = storageProvider();
  const etag = `"${document.id}-${document.updatedAt.getTime().toString(36)}"`;

  if (document.thumbnailStorageKey) {
    const existing = await provider.getObject(document.thumbnailStorageKey);
    if (existing) return { body: existing, contentType: THUMBNAIL_CONTENT_TYPE, etag };
  }

  const original = await provider.getObject(document.storageKey);
  if (!original) throw new StorageError("STORAGE_OBJECT_MISSING");

  let body: Uint8Array;
  try {
    body = await sharp(original, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT, fit: "cover", position: "attention", withoutEnlargement: false })
      .webp({ quality: 78 })
      .toBuffer();
  } catch {
    // A file that verified as an image but will not decode is a preview
    // failure, not a server error — the card falls back to its placeholder.
    throw new StorageError("PREVIEW_FAILED");
  }

  const thumbnailKey = buildDerivedKey({
    companyId,
    documentId: document.id,
    kind: "thumb",
    extension: "webp",
  });
  await provider.putObject(thumbnailKey, body, THUMBNAIL_CONTENT_TYPE);

  // Conditional on the object it was built from, so a version promoted while
  // this ran is not given the previous version's thumbnail.
  await prisma.document.updateMany({
    where: { id: document.id, companyId, storageKey: document.storageKey },
    data: { thumbnailStorageKey: thumbnailKey },
  });

  return { body, contentType: THUMBNAIL_CONTENT_TYPE, etag };
}
