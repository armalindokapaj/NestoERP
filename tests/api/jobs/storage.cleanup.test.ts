import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { reconcileStorageUsage } from "@/lib/modules/documents/storage/cleanup.service";
import { cleanupSessions, prisma } from "../../helpers";
import { COMPANY_A, COMPANY_B, COMPANY_SUSPENDED, invokeJob } from "./job-harness";
import {
  abandonedUpload,
  failingStorage,
  fixtureId,
  hoursAgo,
  memberOf,
  minutesAgo,
  objectExists,
  releaseTemporaryStorage,
  removeStoredFiles,
  storedDocument,
  storedVersion,
  uploadSession,
  useTemporaryStorage,
} from "./stored-files";

/**
 * storage.cleanup — abandoned uploads (PRD #51 §97, §98, §194; PRD #29 §130-§133).
 *
 * Real storage in a temporary directory; rows written in the state an upload
 * abandoned two days ago leaves.
 */

const JOB = "storage.cleanup";

const documentRow = (id: string) => prisma.document.findUnique({ where: { id } });

beforeAll(async () => {
  await useTemporaryStorage();
});

afterEach(async () => {
  await useTemporaryStorage();
  await removeStoredFiles();
});

afterAll(async () => {
  await releaseTemporaryStorage();
  await reconcileStorageUsage();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("storage.cleanup", () => {
  describe("idempotency", () => {
    it("removes an abandoned placeholder and its object once; a second run finds nothing to do", async () => {
      const upload = await abandonedUpload(COMPANY_A);

      await invokeJob(JOB);
      expect(await documentRow(upload.id)).toBeNull();
      expect(await objectExists(upload.storageKey)).toBe(false);

      const second = await invokeJob(JOB);
      expect(second.detail).toMatchObject({ sessionsExpired: 0, documentsRemoved: 0, documentsFailed: 0, objectsDeleted: 0 });
    });

    it("expires a session that ran out of time once, and releases its reservation", async () => {
      const document = await storedDocument(COMPANY_A, { storageStatus: "PENDING_UPLOAD" });
      const sessionId = await uploadSession(COMPANY_A, { documentId: document.id, documentVersionId: document.versionId, storageKey: document.storageKey, status: "UPLOADING", expiresAt: minutesAgo(1) });
      await prisma.documentUploadSession.update({ where: { id: sessionId }, data: { reservedBytes: BigInt(64) } });

      const first = await invokeJob(JOB);
      const second = await invokeJob(JOB);

      expect(await prisma.documentUploadSession.findUniqueOrThrow({ where: { id: sessionId } })).toMatchObject({ status: "EXPIRED", reservedBytes: BigInt(0) });
      expect((first.detail as { sessionsExpired: number }).sessionsExpired).toBeGreaterThanOrEqual(1);
      expect(second.detail).toMatchObject({ sessionsExpired: 0 });
      // Inside the grace period: the placeholder and its object are left alone (PRD #29 §130).
      expect(await documentRow(document.id)).not.toBeNull();
      expect(await objectExists(document.storageKey)).toBe(true);
    });

    it("reports a dry run and changes nothing", async () => {
      const upload = await abandonedUpload(COMPANY_A);

      const dry = await invokeJob(JOB, { dryRun: true, companyIds: [COMPANY_A] });

      expect(dry.detail).toMatchObject({ documentsRemoved: 1, objectsDeleted: 1 });
      expect(await documentRow(upload.id)).toMatchObject({ storageStatus: "PENDING_UPLOAD" });
      expect(await objectExists(upload.storageKey)).toBe(true);
    });
  });

  describe("concurrency", () => {
    it("two runs at once remove an abandoned placeholder and its object once", async () => {
      const upload = await abandonedUpload(COMPANY_A);

      const runs = await Promise.all([invokeJob(JOB), invokeJob(JOB)]);

      const total = (field: "documentsRemoved" | "objectsDeleted") => runs.reduce((sum, run) => sum + (run.detail as Record<string, number>)[field], 0);
      expect(total("documentsRemoved")).toBe(1);
      expect(total("objectsDeleted")).toBe(1);
      expect(await documentRow(upload.id)).toBeNull();
    });

    it("never deletes an object a verified document is served from, whatever an upload session says (§194)", async () => {
      const served = await storedDocument(COMPANY_A);
      // A placeholder whose abandoned session names the key a live document serves.
      const placeholder = await storedDocument(COMPANY_A, { storageStatus: "PENDING_UPLOAD", bytes: null });
      await uploadSession(COMPANY_A, { documentId: placeholder.id, storageKey: served.storageKey });

      await Promise.all([invokeJob(JOB), invokeJob(JOB)]);

      expect(await documentRow(placeholder.id)).toBeNull();
      expect(await documentRow(served.id)).toMatchObject({ storageStatus: "AVAILABLE" });
      expect(await objectExists(served.storageKey)).toBe(true);
    });
  });

  describe("failure", () => {
    it("marks a placeholder a draft revision points at FAILED instead of wedging on it, and cleans the uploads after it", async () => {
      const referenced = await abandonedUpload(COMPANY_A);
      const next = await abandonedUpload(COMPANY_A);
      const revision = await prisma.engineeringDocumentRevision.create({
        data: { companyId: COMPANY_A, engineeringDocumentId: "engdoc_arc_sd_023", revisionCode: fixtureId("rev"), documentId: referenced.id, status: "DRAFT", createdByMemberId: await memberOf(COMPANY_A) },
        select: { id: true },
      });

      await invokeJob(JOB);
      await invokeJob(JOB);

      expect(await documentRow(referenced.id)).toMatchObject({ storageStatus: "FAILED", rejectionReason: "STORAGE_OBJECT_MISSING" });
      expect(await prisma.documentVersion.findUniqueOrThrow({ where: { id: referenced.versionId } })).toMatchObject({ storageStatus: "FAILED" });
      expect(await prisma.engineeringDocumentRevision.findUniqueOrThrow({ where: { id: revision.id } })).toMatchObject({ documentId: referenced.id });
      // The upload never completed, so its bytes are nobody's.
      expect(await objectExists(referenced.storageKey)).toBe(false);
      expect(await documentRow(next.id)).toBeNull();
    });

    it("keeps a placeholder a compliance item holds as evidence, rather than emptying the item unaudited", async () => {
      const evidence = await abandonedUpload(COMPANY_A);
      const item = await prisma.contractorComplianceItem.create({
        data: { companyId: COMPANY_A, contractorId: "contractor_apex", type: "INSURANCE", title: fixtureId("compliance"), documentId: evidence.id, createdByMemberId: await memberOf(COMPANY_A) },
        select: { id: true },
      });

      await invokeJob(JOB);

      expect(await documentRow(evidence.id)).toMatchObject({ storageStatus: "FAILED" });
      expect(await prisma.contractorComplianceItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ documentId: evidence.id });
    });

    it("counts an object storage would not delete, still cleans the other uploads, and fails the run", async () => {
      const storage = await failingStorage();
      const stuck = await abandonedUpload(COMPANY_A);
      const other = await abandonedUpload(COMPANY_A);
      storage.failDelete = (key) => key === stuck.storageKey;

      await expect(invokeJob(JOB)).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });

      // The database decided before storage was asked, so nothing is half-written:
      // the placeholder is gone and the dead object is all that is left of it.
      expect(await documentRow(stuck.id)).toBeNull();
      expect(await objectExists(stuck.storageKey)).toBe(true);
      expect(await documentRow(other.id)).toBeNull();
      expect(await objectExists(other.storageKey)).toBe(false);
    });

    it("fails an abandoned version upload, on an archived document too, and keeps the file the document serves", async () => {
      const document = await storedDocument(COMPANY_A, { archived: true });
      const version = await storedVersion(document, 2, { storageStatus: "PENDING_UPLOAD" });
      await prisma.documentVersion.update({ where: { id: version.id }, data: { createdAt: hoursAgo(49) } });
      await uploadSession(COMPANY_A, { documentId: document.id, documentVersionId: version.id, storageKey: version.storageKey, status: "ABORTED" });

      await invokeJob(JOB);

      expect(await prisma.documentVersion.findUniqueOrThrow({ where: { id: version.id } })).toMatchObject({ storageStatus: "FAILED", rejectionReason: "UPLOAD_NOT_COMPLETED" });
      expect(await objectExists(version.storageKey)).toBe(false);
      expect(await documentRow(document.id)).toMatchObject({ storageStatus: "ARCHIVED", currentVersionId: document.versionId });
      expect(await objectExists(document.storageKey)).toBe(true);
    });
  });

  describe("company isolation", () => {
    it("a run narrowed to one company cleans only that company's uploads", async () => {
      const inA = await abandonedUpload(COMPANY_A);
      const inB = await abandonedUpload(COMPANY_B);

      await invokeJob(JOB, { companyIds: [COMPANY_B] });

      expect(await documentRow(inB.id)).toBeNull();
      expect(await documentRow(inA.id)).toMatchObject({ storageStatus: "PENDING_UPLOAD" });
      expect(await objectExists(inA.storageKey)).toBe(true);
    });
  });

  describe("suspended company", () => {
    it("cleans a suspended company's abandoned uploads: the registry declares it INCLUDED", async () => {
      const upload = await abandonedUpload(COMPANY_SUSPENDED);

      await invokeJob(JOB);

      expect(await documentRow(upload.id)).toBeNull();
      expect(await objectExists(upload.storageKey)).toBe(false);
    });
  });
});
