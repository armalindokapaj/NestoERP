import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { findOrphanedDocuments, reconcileStorageUsage } from "@/lib/modules/documents/storage/cleanup.service";
import { cleanupSessions, prisma } from "../../helpers";
import { COMPANY_A, COMPANY_B, COMPANY_SUSPENDED, invokeJob } from "./job-harness";
import { failingStorage, releaseTemporaryStorage, removeStoredFiles, storedDocument, storedVersion, useTemporaryStorage } from "./stored-files";

/**
 * storage.orphans — verified files whose object has gone (PRD #29 §128; PRD #51 §281).
 *
 * Read-only: every assertion that something was found is paired with one that
 * nothing changed. Storage is a temporary directory, so the seeded files of
 * the companies these tests narrow to have no objects either — each test
 * counts in the suspended company, which has no seeded files, or asks about
 * its own fixtures by key.
 */

const JOB = "storage.orphans";

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

/** A company's worth of files: one intact, and a served, an archived and a historical one whose objects are gone. */
async function missingFiles(companyId: string) {
  const intact = await storedDocument(companyId);
  const served = await storedDocument(companyId, { bytes: null });
  const archived = await storedDocument(companyId, { archived: true, bytes: null });
  const withHistory = await storedDocument(companyId, { bytes: null });
  await storedVersion(withHistory, 2, { current: true });
  return { intact, served, archived, withHistory };
}

describe("storage.orphans", () => {
  describe("idempotency", () => {
    it("reports the same orphans every run — served, archived and history alike — and changes nothing", async () => {
      const files = await missingFiles(COMPANY_SUSPENDED);
      const before = await prisma.document.findMany({ where: { companyId: COMPANY_SUSPENDED }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } });

      const first = await invokeJob(JOB, { companyIds: [COMPANY_SUSPENDED] });
      const second = await invokeJob(JOB, { companyIds: [COMPANY_SUSPENDED] });

      expect(first.processed).toBe(3);
      expect(second.processed).toBe(3);
      const found = await findOrphanedDocuments({ limit: 10_000 });
      expect(found).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ documentId: files.served.id, documentVersionId: null }),
          expect.objectContaining({ documentId: files.archived.id, documentVersionId: null }),
          expect.objectContaining({ documentId: files.withHistory.id, documentVersionId: files.withHistory.versionId }),
        ]),
      );
      expect(found.map((orphan) => orphan.documentId)).not.toContain(files.intact.id);
      expect(await prisma.document.findMany({ where: { companyId: COMPANY_SUSPENDED }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } })).toEqual(before);
    });
  });

  describe("failure", () => {
    it("reports nothing when storage is not answering, and fails the run to be retried", async () => {
      const storage = await failingStorage();
      await missingFiles(COMPANY_SUSPENDED);
      storage.healthy = false;

      await expect(invokeJob(JOB, { companyIds: [COMPANY_SUSPENDED] })).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE", retryable: true });
      expect(storage.headed).toEqual([]);
    });

    it("counts an object storage would not answer for, still checks the rest, and fails the run", async () => {
      const storage = await failingStorage();
      const files = await missingFiles(COMPANY_SUSPENDED);
      storage.failHead = (key) => key === files.served.storageKey;

      await expect(invokeJob(JOB, { companyIds: [COMPANY_SUSPENDED] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
      expect(storage.headed).toEqual(expect.arrayContaining([files.served.storageKey, files.archived.storageKey, files.withHistory.storageKey, files.intact.storageKey]));
    });
  });

  describe("company isolation", () => {
    it("a run narrowed to one company checks only that company's objects", async () => {
      const storage = await failingStorage();
      const inA = await missingFiles(COMPANY_A);
      const inB = await missingFiles(COMPANY_B);

      await invokeJob(JOB, { companyIds: [COMPANY_B] });

      expect(storage.headed).toContain(inB.served.storageKey);
      expect(storage.headed).not.toContain(inA.served.storageKey);
      const checkedCompanies = await prisma.document.findMany({ where: { storageKey: { in: storage.headed } }, select: { companyId: true }, distinct: ["companyId"] });
      expect(checkedCompanies.map((row) => row.companyId)).toEqual([COMPANY_B]);
    });
  });

  describe("suspended company", () => {
    it("checks a suspended company's objects too: the registry declares it INCLUDED", async () => {
      const storage = await failingStorage();
      const files = await missingFiles(COMPANY_SUSPENDED);

      await invokeJob(JOB);

      expect(storage.headed).toEqual(expect.arrayContaining([files.served.storageKey, files.archived.storageKey]));
      expect((await findOrphanedDocuments({ limit: 10_000 })).map((orphan) => orphan.documentId)).toContain(files.served.id);
    });
  });
});
