import type { UserContext } from "@/lib/context/types";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import {
  PREVIEW_URL_TTL_SECONDS,
  StorageError,
} from "@/lib/core/storage";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { requireDownloadableDocument } from "./storage-access.service";
import type { PreviewGrant } from "./storage.types";

/**
 * Preview grants (PRD #29 §104-§107, §327).
 *
 * Preview is a separate endpoint from download because it is a different
 * decision, not a different parameter. A download hands over bytes; a preview
 * asks a browser to *render* them, and that is only ever safe for formats that
 * cannot execute (PRD #29 §44, §240).
 *
 * The V0.1 set is PDF, JPEG, PNG and WEBP, and for all four the original file
 * is already inline-safe — so the preview is the original, served with a
 * verified content type and `inline` disposition. No derived object is
 * generated, no conversion pipeline is pretended into existence, and Office
 * files are download-only (PRD #29 §45, §53).
 *
 * Thumbnails are deliberately not built. The columns and the derived-key
 * layout exist for them (PRD #29 §51, §237); generating them is explicitly
 * optional in §53 and NESTO V0.1 does not.
 */

export async function createPreviewGrant(
  context: UserContext,
  documentId: string,
): Promise<PreviewGrant> {
  // Identical authorisation to a download: the same permissions, the same
  // parent access, the same company isolation (PRD #29 §105).
  const document = await requireDownloadableDocument(context, documentId);
  if (!document.storageKey) throw new StorageError("STORAGE_OBJECT_MISSING");

  if (document.previewStatus === "NOT_REQUIRED") throw new StorageError("PREVIEW_NOT_SUPPORTED");
  if (document.previewStatus === "FAILED") throw new StorageError("PREVIEW_FAILED");
  if (document.previewStatus !== "READY") throw new StorageError("PREVIEW_NOT_READY");

  const mimeType = document.previewMimeType ?? document.detectedMimeType ?? document.mimeType;
  const kind = previewKind(mimeType);
  if (!kind) throw new StorageError("PREVIEW_NOT_SUPPORTED");

  const fileName = document.originalFileName ?? document.fileName ?? document.name;

  const grant = await storageProvider().createDownloadUrl({
    // The derived key when one exists, the original otherwise. Both are
    // equally private (PRD #29 §238).
    storageKey: document.previewStorageKey ?? document.storageKey,
    expiresInSeconds: PREVIEW_URL_TTL_SECONDS,
    disposition: "inline",
    fileName,
    contentType: mimeType!,
  });

  await recordUserAction(context, {
    actionKey: AuditAction.DOCUMENT_PREVIEW_GRANTED,
    entity: { type: "Document", id: documentId, label: document.name },
    projectId: document.projectId,
  });

  return {
    url: grant.url,
    expiresAt: grant.expiresAt.toISOString(),
    mimeType: mimeType!,
    kind,
  };
}

/**
 * The only content types a browser is asked to render.
 *
 * An allowlist by verified type rather than by extension, because the
 * extension is what the uploader chose and the type is what the bytes said
 * (PRD #29 §195).
 */
function previewKind(mimeType: string | null): "pdf" | "image" | null {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/webp") {
    return "image";
  }
  return null;
}
