import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { reconcileStorageUsage } from "@/lib/modules/documents/storage/cleanup.service";
import * as quota from "@/lib/modules/documents/storage/quota.service";
import { cleanupSessions, prisma } from "../../helpers";
import { COMPANY_A, COMPANY_B, COMPANY_SUSPENDED, invokeJob, withCompanyStatus } from "./job-harness";

/**
 * storage.usage — the storage usage projection rebuilt from the documents
 * (PRD #29 §148, PRD #35 §238, PRD #51 §18, §145).
 *
 * A recompute: each test knocks a projection out of true and checks the job
 * puts back exactly what the documents add up to. `afterEach` rebuilds every
 * company, so nothing a test knocked over is left for the next file.
 */

const JOB = "storage.usage";

/** What the documents say a company stores — the definition the job must reproduce. */
async function truth(companyId: string) {
  const aggregate = await prisma.document.aggregate({
    where: { companyId, storageKey: { not: null }, storageStatus: { not: "REJECTED" } },
    _sum: { sizeBytes: true },
    _count: true,
  });
  return { usedBytes: aggregate._sum.sizeBytes ?? BigInt(0), fileCount: aggregate._count };
}

async function drift(companyId: string) {
  await prisma.companyStorageUsage.upsert({
    where: { companyId },
    create: { companyId, usedBytes: BigInt(987_654_321), fileCount: 4321 },
    update: { usedBytes: BigInt(987_654_321), fileCount: 4321 },
  });
}

const projection = (companyId: string) =>
  prisma.companyStorageUsage.findUniqueOrThrow({ where: { companyId }, select: { usedBytes: true, fileCount: true } });

afterEach(async () => {
  vi.restoreAllMocks();
  await reconcileStorageUsage();
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("storage.usage", () => {
  describe("idempotency", () => {
    it("rebuilds a drifted projection from the documents, and a second run writes the same numbers", async () => {
      await drift(COMPANY_A);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const first = await projection(COMPANY_A);
      await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(first).toEqual(await truth(COMPANY_A));
      expect(await projection(COMPANY_A)).toEqual(first);
    });
  });

  describe("failure", () => {
    it("rebuilds every other company when one fails, then fails the run", async () => {
      await drift(COMPANY_B);
      const recalculate = quota.recalculateUsage;
      vi.spyOn(quota, "recalculateUsage").mockImplementation(async (companyId) => {
        if (companyId === COMPANY_A) throw new Error("usage row locked out");
        return recalculate(companyId);
      });

      await expect(invokeJob(JOB)).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });

      expect(await projection(COMPANY_B)).toEqual(await truth(COMPANY_B));
    });
  });

  describe("company isolation", () => {
    it("a run narrowed to one company rebuilds only that company's projection", async () => {
      await drift(COMPANY_A);
      await drift(COMPANY_B);

      const run = await invokeJob(JOB, { companyIds: [COMPANY_B] });

      expect(run.processed).toBe(1);
      expect(await projection(COMPANY_B)).toEqual(await truth(COMPANY_B));
      expect(await projection(COMPANY_A)).toEqual({ usedBytes: BigInt(987_654_321), fileCount: 4321 });
    });
  });

  describe("suspended company", () => {
    it("rebuilds a suspended company's projection too: the registry declares it INCLUDED", async () => {
      await drift(COMPANY_SUSPENDED);
      await invokeJob(JOB);
      expect(await projection(COMPANY_SUSPENDED)).toEqual(await truth(COMPANY_SUSPENDED));

      await withCompanyStatus(COMPANY_B, "SUSPENDED", async () => {
        await drift(COMPANY_B);
        await invokeJob(JOB, { companyIds: [COMPANY_B] });
      });
      expect(await projection(COMPANY_B)).toEqual(await truth(COMPANY_B));
    });
  });
});
