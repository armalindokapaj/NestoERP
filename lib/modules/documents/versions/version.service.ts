import type { DocumentReviewState, DocumentReviewStatus, DocumentStorageStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { DOWNLOAD_URL_TTL_SECONDS, StorageError } from "@/lib/core/storage";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { prisma } from "@/lib/database/prisma";
import { canAttachToDocumentParent, classifyDocumentParent } from "../document.parent-access";
import { requireDocument } from "../storage/storage-access.service";
import type { DownloadGrant } from "../storage/storage.types";

/**
 * Document version history (PRD #38 §56-§58, §67).
 *
 * Reading a version is reading its document: the same parent authorisation,
 * every time. A version id alone opens nothing — it is always resolved inside
 * a document this caller may already see (PRD #38 §150).
 */

export type DocumentReviewDTO = {
  id: string;
  status: DocumentReviewStatus;
  reviewer: { memberId: string; fullName: string };
  requestedBy: { memberId: string; fullName: string };
  requestNote: string | null;
  decisionNote: string | null;
  requestedAt: string;
  decidedAt: string | null;
  canDecide: boolean;
};

export type DocumentVersionDTO = {
  id: string;
  versionNumber: number;
  current: boolean;
  fileName: string | null;
  sizeBytes: string | null;
  checksumSha256: string | null;
  storageStatus: DocumentStorageStatus;
  reviewState: DocumentReviewState;
  changeNote: string | null;
  uploadedBy: { memberId: string; fullName: string } | null;
  createdAt: string;
  supersededAt: string | null;
  reviews: DocumentReviewDTO[];
  capabilities: { canDownload: boolean; canRequestReview: boolean };
};

export type VersionHistoryDTO = {
  documentId: string;
  versions: DocumentVersionDTO[];
  capabilities: { canUploadVersion: boolean; reviewable: boolean };
};

/** Whether a document's parent allows review at all (PRD #38 §59). */
export function documentReviewable(document: { projectId: string | null; clientId: string | null; module: string | null; entityType: string | null; entityId: string | null }): boolean {
  const parent = classifyDocumentParent(document);
  if (parent.kind === "record") return parent.definition.documents?.reviewable ?? false;
  // Project, client and company documents are ordinary controlled documents.
  return parent.kind !== "unregistered";
}

async function memberNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.companyMember.findMany({
    where: { id: { in: unique } },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  return new Map(rows.map((row) => [row.id, `${row.user.firstName} ${row.user.lastName}`]));
}

export async function listVersions(context: UserContext, documentId: string): Promise<VersionHistoryDTO> {
  const document = await requireDocument(context, documentId);
  const archived = document.status === "ARCHIVED" || document.archivedAt !== null;
  const reviewable = documentReviewable(document);

  const versions = await prisma.documentVersion.findMany({
    where: { documentId: document.id, companyId: context.companyId },
    orderBy: { versionNumber: "desc" },
    include: { reviews: { orderBy: { requestedAt: "desc" } } },
  });
  const current = await prisma.document.findUnique({ where: { id: document.id }, select: { currentVersionId: true } });

  const names = await memberNames(
    versions.flatMap((version) => [
      version.uploadedByMemberId,
      ...version.reviews.flatMap((review) => [review.reviewerMemberId, review.requestedByMemberId]),
    ]),
  );
  const name = (id: string) => names.get(id) ?? "Former member";

  const canUploadVersion =
    !archived &&
    document.storageStatus === "AVAILABLE" &&
    can(context, "document.update") &&
    (await canAttachToDocumentParent(context, document));

  return {
    documentId: document.id,
    capabilities: { canUploadVersion, reviewable },
    versions: versions.map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      current: version.id === current?.currentVersionId,
      fileName: version.originalFileName ?? version.fileName,
      sizeBytes: version.sizeBytes?.toString() ?? null,
      checksumSha256: version.checksumSha256,
      storageStatus: version.storageStatus,
      reviewState: version.reviewState,
      changeNote: version.changeNote,
      uploadedBy: version.uploadedByMemberId ? { memberId: version.uploadedByMemberId, fullName: name(version.uploadedByMemberId) } : null,
      createdAt: version.createdAt.toISOString(),
      supersededAt: version.supersededAt?.toISOString() ?? null,
      reviews: version.reviews.map((review) => ({
        id: review.id,
        status: review.status,
        reviewer: { memberId: review.reviewerMemberId, fullName: name(review.reviewerMemberId) },
        requestedBy: { memberId: review.requestedByMemberId, fullName: name(review.requestedByMemberId) },
        requestNote: review.requestNote,
        decisionNote: review.decisionNote,
        requestedAt: review.requestedAt.toISOString(),
        decidedAt: review.decidedAt?.toISOString() ?? null,
        canDecide:
          review.status === "PENDING" &&
          review.reviewerMemberId === context.membershipId &&
          can(context, "document.review.decide"),
      })),
      capabilities: {
        canDownload: version.storageStatus === "AVAILABLE" && can(context, "document.download"),
        canRequestReview:
          reviewable &&
          !archived &&
          version.storageStatus === "AVAILABLE" &&
          (version.reviewState === "DRAFT" || version.reviewState === "IN_REVIEW" || version.reviewState === "REJECTED") &&
          can(context, "document.review.request"),
      },
    })),
  };
}

/**
 * A short-lived grant for one historical version (PRD #38 §58, §150).
 *
 * The document is authorised first, then the version is looked up inside it —
 * so a version id from another document or another company is not found.
 */
export async function createVersionDownloadGrant(
  context: UserContext,
  documentId: string,
  versionId: string,
): Promise<DownloadGrant> {
  const document = await requireDocument(context, documentId);
  if (!can(context, "document.download")) throw new AccessError("FORBIDDEN");

  const version = await prisma.documentVersion.findFirst({
    where: { id: versionId, documentId: document.id, companyId: context.companyId },
  });
  if (!version) throw new StorageError("DOCUMENT_NOT_FOUND");
  if (version.storageStatus !== "AVAILABLE") throw new StorageError("DOCUMENT_NOT_AVAILABLE");

  const fileName = version.originalFileName ?? version.fileName ?? `${document.name}-v${version.versionNumber}`;
  const grant = await storageProvider().createDownloadUrl({
    storageKey: version.storageKey,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    disposition: "attachment",
    fileName,
    contentType: version.mimeTypeDetected ?? version.mimeTypeDeclared ?? "application/octet-stream",
  });

  await recordUserAction(context, {
    actionKey: AuditAction.DOCUMENT_DOWNLOAD_GRANTED,
    entity: { type: "Document", id: document.id, label: document.name },
    projectId: document.projectId,
    metadata: { versionNumber: version.versionNumber },
  });

  return { url: grant.url, expiresAt: grant.expiresAt.toISOString(), fileName };
}
