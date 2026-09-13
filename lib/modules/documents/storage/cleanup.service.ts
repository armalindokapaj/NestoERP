import { prisma } from "@/lib/database/prisma";
import { logger } from "@/lib/core/observability/logger";
import {
  ORPHAN_GRACE_PERIOD_MS,
} from "@/lib/core/storage";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import * as quota from "./quota.service";

/**
 * Storage cleanup (PRD #29 §127-§133, §232, §329).
 *
 * The database and the object store cannot commit together, so the system is
 * eventually consistent by construction and something has to reconcile it.
 * That is this file.
 *
 * Two failure shapes, both real:
 *
 *   an object with no live document   the browser uploaded and never confirmed
 *   a document with no object         the confirmation never happened at all
 *
 * Both are left alone until the session has expired *and* the grace period has
 * passed, because deleting a file somebody is slowly uploading over a site
 * connection is far worse than keeping a dead object for another day
 * (PRD #29 §130, §317).
 *
 * Multipart uploads are explicitly out of scope, not overlooked. V0.1 uploads
 * are a single PUT — §124 says multipart is not mandatory below 100 MB — so
 * there is no multipart state to abort. `DocumentUploadSession` carries
 * `multipartUploadId` and the provider interface carries the three multipart
 * methods so that adding it is a provider change rather than a redesign; when
 * it arrives, the §126/§228 abort rule belongs in this file, alongside a
 * bucket lifecycle rule that aborts incomplete uploads after a day.
 */

export type CleanupResult = {
  sessionsExpired: number;
  objectsDeleted: number;
  documentsFailed: number;
  documentsRemoved: number;
};

export async function runStorageCleanup(
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<CleanupResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun === true;
  const cutoff = new Date(now.getTime() - ORPHAN_GRACE_PERIOD_MS);

  const result: CleanupResult = {
    sessionsExpired: 0,
    objectsDeleted: 0,
    documentsFailed: 0,
    documentsRemoved: 0,
  };

  /*
   * Sessions that ran out of time. Marked EXPIRED immediately — the quota
   * reservation they hold should not outlive the window they were granted for
   * — but their objects are only removed once the grace period has also passed
   * (PRD #29 §131).
   */
  const expired = await prisma.documentUploadSession.findMany({
    where: { status: { in: ["CREATED", "UPLOADING"] }, expiresAt: { lt: now } },
    select: { id: true, documentId: true, storageKey: true, companyId: true, expiresAt: true },
  });

  for (const session of expired) {
    result.sessionsExpired += 1;
    if (dryRun) continue;

    await prisma.documentUploadSession.updateMany({
      where: { id: session.id, status: { in: ["CREATED", "UPLOADING"] } },
      data: { status: "EXPIRED", reservedBytes: BigInt(0) },
    });
  }

  // Abandoned uploads past the grace period: the object, if any, goes, and the
  // placeholder document follows it.
  const abandoned = await prisma.documentUploadSession.findMany({
    where: {
      status: { in: ["EXPIRED", "ABORTED", "FAILED"] },
      expiresAt: { lt: cutoff },
      document: { storageStatus: { in: ["PENDING_UPLOAD", "UPLOADED", "VERIFYING"] } },
    },
    select: {
      id: true,
      documentId: true,
      storageKey: true,
      companyId: true,
      document: { select: { storageStatus: true } },
    },
  });

  const provider = storageProvider();

  for (const session of abandoned) {
    const exists = await provider.headObject(session.storageKey);

    if (exists) {
      result.objectsDeleted += 1;
      if (!dryRun) await provider.deleteObject(session.storageKey).catch(() => undefined);
    }

    if (dryRun) {
      result.documentsRemoved += 1;
      continue;
    }

    /*
     * A placeholder that never completed carries no history worth keeping, so
     * it is removed outright — which is the one case §133 allows a hard delete
     * for. Anything that picked up activity on the way is marked FAILED
     * instead, so the trail survives (PRD #29 §132, §133).
     */
    const activityCount = await prisma.activity.count({
      where: { entityType: "Document", entityId: session.documentId },
    });

    if (activityCount === 0) {
      await prisma.document.deleteMany({
        where: {
          id: session.documentId,
          storageStatus: { in: ["PENDING_UPLOAD", "UPLOADED", "VERIFYING"] },
        },
      });
      result.documentsRemoved += 1;
    } else {
      await prisma.document.updateMany({
        where: {
          id: session.documentId,
          storageStatus: { in: ["PENDING_UPLOAD", "UPLOADED", "VERIFYING"] },
        },
        data: {
          storageStatus: "FAILED",
          rejectionReason: "STORAGE_OBJECT_MISSING",
          rejectedAt: now,
        },
      });
      result.documentsFailed += 1;
    }
  }

  /*
   * A later version whose upload never completed (PRD #38 §58). The document
   * keeps serving its current version; the unfinished one is marked FAILED —
   * its number stays spent, so version numbers never get reused — and its
   * object, if any, goes.
   */
  const abandonedVersions = await prisma.documentUploadSession.findMany({
    where: {
      status: { in: ["EXPIRED", "ABORTED", "FAILED"] },
      expiresAt: { lt: cutoff },
      documentVersionId: { not: null },
      document: { storageStatus: "AVAILABLE" },
    },
    select: { id: true, storageKey: true, documentVersionId: true, document: { select: { currentVersionId: true } } },
  });

  for (const session of abandonedVersions) {
    if (!session.documentVersionId || session.document.currentVersionId === session.documentVersionId) continue;
    const version = await prisma.documentVersion.findUnique({
      where: { id: session.documentVersionId },
      select: { storageStatus: true },
    });
    if (!version || !["PENDING_UPLOAD", "UPLOADED", "VERIFYING"].includes(version.storageStatus)) continue;

    if (await provider.headObject(session.storageKey)) {
      result.objectsDeleted += 1;
      if (!dryRun) await provider.deleteObject(session.storageKey).catch(() => undefined);
    }
    result.documentsFailed += 1;
    if (dryRun) continue;
    await prisma.documentVersion.updateMany({
      where: { id: session.documentVersionId, storageStatus: { in: ["PENDING_UPLOAD", "UPLOADED", "VERIFYING"] } },
      data: { storageStatus: "FAILED", rejectionReason: "UPLOAD_NOT_COMPLETED" },
    });
  }

  if (!dryRun && (result.objectsDeleted > 0 || result.documentsRemoved > 0)) {
    logger.info("storage.cleanup.completed", { ...result });
  }

  return result;
}

/**
 * Finds documents whose object has gone missing (PRD #29 §128).
 *
 * Read-only by design. A vanished object behind an AVAILABLE document is an
 * incident, not a tidying job: it is reported so somebody restores it from
 * backup, never silently deleted (PRD #33 owns recovery).
 */
export async function findOrphanedDocuments(
  options: { limit?: number } = {},
): Promise<{ documentId: string; companyId: string; storageKey: string }[]> {
  const candidates = await prisma.document.findMany({
    where: { storageStatus: "AVAILABLE", storageKey: { not: null } },
    select: { id: true, companyId: true, storageKey: true },
    orderBy: { updatedAt: "desc" },
    take: options.limit ?? 500,
  });

  const provider = storageProvider();
  const orphans: { documentId: string; companyId: string; storageKey: string }[] = [];

  for (const candidate of candidates) {
    const metadata = await provider.headObject(candidate.storageKey!);
    if (!metadata) {
      orphans.push({
        documentId: candidate.id,
        companyId: candidate.companyId,
        storageKey: candidate.storageKey!,
      });
    }
  }

  if (orphans.length > 0) {
    logger.error("storage.orphan.detected", { count: orphans.length });
  }

  return orphans;
}

/**
 * Rebuilds every company's usage projection from its documents.
 *
 * The reconciliation gate PRD #35 §238 asks for: the projection is a
 * convenience, the documents are the truth, and the two should agree.
 */
export async function reconcileStorageUsage(): Promise<
  { companyId: string; usedBytes: string; fileCount: number }[]
> {
  const companies = await prisma.company.findMany({ select: { id: true } });

  const results = [];
  for (const company of companies) {
    const usage = await quota.recalculateUsage(company.id);
    results.push({
      companyId: company.id,
      usedBytes: usage.usedBytes.toString(),
      fileCount: usage.fileCount,
    });
  }
  return results;
}
