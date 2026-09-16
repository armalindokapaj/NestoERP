import type { DocumentStorageStatus } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import { logger } from "@/lib/core/observability/logger";
import { JobError } from "@/lib/core/jobs/job.errors";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { ORPHAN_GRACE_PERIOD_MS } from "@/lib/core/storage";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import * as quota from "./quota.service";
import { sweep, sweepCompanyScope } from "./storage.sweep";

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
 *
 * The order inside each cleanup is the safety property (PRD #51 §97, §98,
 * §194): the database decides first, in a write conditional on the state it
 * read, and only once that has committed — and only for the run whose write
 * it was — is the object deleted, after asking again whether any verified
 * document or version is served from that key. A crash between the two
 * leaves a dead object behind, which costs a few bytes; the other order can
 * cost somebody their file.
 */

export type CleanupResult = {
  sessionsExpired: number;
  objectsDeleted: number;
  documentsFailed: number;
  documentsRemoved: number;
};

/** Where an upload is still in flight, and nothing is served from its key. */
const IN_FLIGHT: DocumentStorageStatus[] = ["PENDING_UPLOAD", "UPLOADED", "VERIFYING"];

/** Where a key is served from, or will be once a verdict lands: never deleted here. */
const SERVED: DocumentStorageStatus[] = ["SCANNING", "AVAILABLE", "ARCHIVED"];

export async function runStorageCleanup(
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<CleanupResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun === true;
  const cutoff = new Date(now.getTime() - ORPHAN_GRACE_PERIOD_MS);
  const scope = sweepCompanyScope();
  const provider = storageProvider();

  const result: CleanupResult = {
    sessionsExpired: 0,
    objectsDeleted: 0,
    documentsFailed: 0,
    documentsRemoved: 0,
  };

  /** Deletes an object this run's own decision released, if nothing verified still claims its key. */
  const deleteReleasedObject = async (storageKey: string, ids: Record<string, string>) => {
    if (await keyIsServed(storageKey)) {
      logger.warn("storage.cleanup.object_kept", { ...ids, reason: "served by a verified file" });
      return;
    }
    if (!(await provider.headObject(storageKey))) return;
    await provider.deleteObject(storageKey);
    result.objectsDeleted += 1;
  };

  /*
   * Sessions that ran out of time. Marked EXPIRED immediately — the quota
   * reservation they hold should not outlive the window they were granted for
   * — but their objects are only removed once the grace period has also passed
   * (PRD #29 §131).
   */
  const expiring = await sweep(
    "storage.cleanup.item_failed",
    (after, take) =>
      prisma.documentUploadSession.findMany({
        where: { status: { in: ["CREATED", "UPLOADING"] }, expiresAt: { lt: now }, ...scope, ...after },
        select: { id: true, companyId: true, status: true },
        orderBy: { id: "asc" },
        take,
      }),
    async (session) => {
      if (dryRun) {
        result.sessionsExpired += 1;
        return;
      }
      const expired = await prisma.documentUploadSession.updateMany({
        where: { id: session.id, status: session.status, expiresAt: { lt: now } },
        data: { status: "EXPIRED", reservedBytes: BigInt(0) },
      });
      result.sessionsExpired += expired.count;
    },
  );

  // Abandoned first uploads past the grace period: the placeholder document
  // goes, or fails, and then the object, if any, follows it.
  const abandoned = await sweep(
    "storage.cleanup.item_failed",
    (after, take) =>
      prisma.documentUploadSession.findMany({
        where: {
          status: { in: ["EXPIRED", "ABORTED", "FAILED"] },
          expiresAt: { lt: cutoff },
          document: { storageStatus: { in: IN_FLIGHT } },
          ...scope,
          ...after,
        },
        select: { id: true, companyId: true, documentId: true, storageKey: true },
        orderBy: { id: "asc" },
        take,
      }),
    async (session) => {
      if (dryRun) {
        if (await placeholderRemovable(session.documentId)) result.documentsRemoved += 1;
        else result.documentsFailed += 1;
        if (!(await keyIsServed(session.storageKey)) && (await provider.headObject(session.storageKey))) result.objectsDeleted += 1;
        return;
      }

      /*
       * A placeholder that never completed carries no history worth keeping, so
       * it is removed outright — which is the one case §133 allows a hard delete
       * for. Anything that picked up activity on the way, or that another record
       * already points at — a draft revision, a compliance item's evidence — is
       * marked FAILED instead, so the trail survives and that record is not
       * broken, or silently emptied, from under it (PRD #29 §132, §133).
       * Asked in the delete itself, so a reference is never the wedge that stops
       * every session after it.
       */
      const decision = await prisma.$transaction(async (tx) => {
        const history = await tx.activity.count({ where: { entityType: "Document", entityId: session.documentId } });
        if (history === 0) {
          const removed = await tx.document.deleteMany({
            where: {
              id: session.documentId,
              storageStatus: { in: IN_FLIGHT },
              engineeringRevisions: { none: {} },
              submittalRevisions: { none: {} },
              transmittalItems: { none: {} },
              contractorComplianceItems: { none: {} },
            },
          });
          if (removed.count > 0) return "REMOVED";
        }
        const failed = await tx.document.updateMany({
          where: { id: session.documentId, storageStatus: { in: IN_FLIGHT } },
          data: { storageStatus: "FAILED", rejectionReason: "STORAGE_OBJECT_MISSING", rejectedAt: now },
        });
        if (failed.count === 0) return "UNCHANGED";
        // Version 1 carries the same key and never completed either.
        await tx.documentVersion.updateMany({
          where: { documentId: session.documentId, storageKey: session.storageKey, storageStatus: { in: IN_FLIGHT } },
          data: { storageStatus: "FAILED", rejectionReason: "STORAGE_OBJECT_MISSING" },
        });
        return "FAILED";
      });
      // Settled by another run in the meantime: its object is that run's to delete.
      if (decision === "UNCHANGED") return;
      if (decision === "REMOVED") result.documentsRemoved += 1;
      else result.documentsFailed += 1;
      await deleteReleasedObject(session.storageKey, { sessionId: session.id, documentId: session.documentId, companyId: session.companyId });
    },
  );

  /*
   * A later version whose upload never completed (PRD #38 §58). The document
   * keeps serving its current version; the unfinished one is marked FAILED —
   * its number stays spent, so version numbers never get reused — and its
   * object, if any, goes. Walked from the versions still in flight, so what
   * is walked shrinks as it is cleaned, and an archived document's abandoned
   * upload is cleaned like any other.
   */
  const abandonedVersions = await sweep(
    "storage.cleanup.item_failed",
    (after, take) =>
      prisma.documentVersion.findMany({
        where: { storageStatus: { in: IN_FLIGHT }, createdAt: { lt: cutoff }, ...scope, ...after },
        select: { id: true, companyId: true, documentId: true, storageKey: true, document: { select: { currentVersionId: true } } },
        orderBy: { id: "asc" },
        take,
      }),
    async (version) => {
      // A first upload's version 1 goes with its document, above.
      if (version.document.currentVersionId === version.id) return;
      const session = await prisma.documentUploadSession.findFirst({
        where: { documentVersionId: version.id },
        select: { status: true, expiresAt: true },
      });
      if (!session || !["EXPIRED", "ABORTED", "FAILED"].includes(session.status) || session.expiresAt >= cutoff) return;

      if (dryRun) {
        result.documentsFailed += 1;
        if (!(await keyIsServed(version.storageKey)) && (await provider.headObject(version.storageKey))) result.objectsDeleted += 1;
        return;
      }
      const failed = await prisma.documentVersion.updateMany({
        // Spelled with the null case, which `not` alone would leave out: a
        // document from before versions has no current version at all.
        where: { id: version.id, storageStatus: { in: IN_FLIGHT }, document: { OR: [{ currentVersionId: null }, { currentVersionId: { not: version.id } }] } },
        data: { storageStatus: "FAILED", rejectionReason: "UPLOAD_NOT_COMPLETED" },
      });
      if (failed.count === 0) return;
      result.documentsFailed += 1;
      await deleteReleasedObject(version.storageKey, { documentVersionId: version.id, documentId: version.documentId, companyId: version.companyId });
    },
  );

  if (!dryRun && (result.objectsDeleted > 0 || result.documentsRemoved > 0 || result.documentsFailed > 0)) {
    logger.info("storage.cleanup.completed", { ...result });
  }

  const failures = expiring.failed + abandoned.failed + abandonedVersions.failed;
  if (failures > 0) throw new JobError("PARTIAL_FAILURE", `storage.cleanup failed for ${failures} upload(s)`);
  return result;
}

/**
 * Whether a verified document or version is served from this key, or will be
 * once its scan lands (PRD #51 §97, §98).
 *
 * Asked immediately before an object is deleted, never trusted from the read
 * that chose it: the session row says which key an upload was granted, not
 * who holds that key now.
 */
async function keyIsServed(storageKey: string): Promise<boolean> {
  const [document, version] = await Promise.all([
    prisma.document.count({ where: { storageKey, storageStatus: { in: SERVED } } }),
    prisma.documentVersion.count({ where: { storageKey, storageStatus: { in: SERVED } } }),
  ]);
  return document + version > 0;
}

/** What the removal above would decide, read without deciding it — for a dry run. */
async function placeholderRemovable(documentId: string): Promise<boolean> {
  const [history, removable] = await Promise.all([
    prisma.activity.count({ where: { entityType: "Document", entityId: documentId } }),
    prisma.document.count({
      where: {
        id: documentId,
        engineeringRevisions: { none: {} },
        submittalRevisions: { none: {} },
        transmittalItems: { none: {} },
        contractorComplianceItems: { none: {} },
      },
    }),
  ]);
  return history === 0 && removable > 0;
}

/**
 * Finds documents and versions whose object has gone missing (PRD #29 §128;
 * PRD #51 §281).
 *
 * Read-only by design. A vanished object behind a verified file is an
 * incident, not a tidying job: it is reported so somebody restores it from
 * backup, never silently deleted (PRD #33 owns recovery).
 *
 * Storage is asked whether it is answering before a single object is: with
 * credentials revoked or a bucket unreachable every HEAD comes back empty,
 * and the report would name every file the company has (PRD #29 §395). That
 * is a retryable failure of the run, never a list of orphans.
 *
 * Every file whose object must exist is checked — archived documents, and the
 * history behind the current version, as well as what is served today — a
 * batch at a time. `limit` bounds the list returned, not the walk: the log
 * carries the full count.
 */
export async function findOrphanedDocuments(
  options: { limit?: number } = {},
): Promise<{ documentId: string; documentVersionId: string | null; companyId: string; storageKey: string }[]> {
  const provider = storageProvider();
  const health = await provider.healthCheck().catch(() => ({ ok: false }));
  if (!health.ok) throw new JobError("STORAGE_UNAVAILABLE", "object storage is not answering; no object was checked");

  const limit = options.limit ?? 500;
  const scope = sweepCompanyScope();
  const orphans: { documentId: string; documentVersionId: string | null; companyId: string; storageKey: string }[] = [];
  let checked = 0;
  let orphaned = 0;

  const check = async (entry: { documentId: string; documentVersionId: string | null; companyId: string; storageKey: string }) => {
    checked += 1;
    if (await provider.headObject(entry.storageKey)) return;
    orphaned += 1;
    if (orphans.length < limit) orphans.push(entry);
  };

  const documents = await sweep(
    "storage.orphans.item_failed",
    (after, take) =>
      prisma.document.findMany({
        where: { storageStatus: { in: SERVED }, storageKey: { not: null }, ...scope, ...after },
        select: { id: true, companyId: true, storageKey: true },
        orderBy: { id: "asc" },
        take,
      }),
    (document) => check({ documentId: document.id, documentVersionId: null, companyId: document.companyId, storageKey: document.storageKey! }),
  );

  // The current version shares its document's key, which the walk above checked.
  const versions = await sweep(
    "storage.orphans.item_failed",
    (after, take) =>
      prisma.documentVersion.findMany({
        where: { storageStatus: { in: SERVED }, ...scope, ...after },
        select: { id: true, companyId: true, documentId: true, storageKey: true, document: { select: { currentVersionId: true, storageKey: true } } },
        orderBy: { id: "asc" },
        take,
      }),
    async (version) => {
      if (version.document.currentVersionId === version.id && version.document.storageKey === version.storageKey) return;
      await check({ documentId: version.documentId, documentVersionId: version.id, companyId: version.companyId, storageKey: version.storageKey });
    },
  );

  if (orphaned > 0) {
    logger.error("storage.orphan.detected", { count: orphaned, checked });
  }

  const failures = documents.failed + versions.failed;
  if (failures > 0) {
    throw new JobError("PARTIAL_FAILURE", `storage.orphans could not check ${failures} object(s)`);
  }
  return orphans;
}

/**
 * Rebuilds every company's usage projection from its documents.
 *
 * The reconciliation gate PRD #35 §238 asks for: the projection is a
 * convenience, the documents are the truth, and the two should agree.
 * Suspended companies too — their files still take up the space (PRD #51
 * §145). One company's failure is reported after the rest have been rebuilt.
 */
export async function reconcileStorageUsage(): Promise<
  { companyId: string; usedBytes: string; fileCount: number }[]
> {
  const report = await forEachCompany(
    "storage.usage",
    async ({ companyId }) => {
      const usage = await quota.recalculateUsage(companyId);
      return { companyId, usedBytes: usage.usedBytes.toString(), fileCount: usage.fileCount };
    },
    { includeInactive: true },
  );
  assertEveryCompanySucceeded("storage.usage", report);
  return report.results.map((row) => row.result);
}
