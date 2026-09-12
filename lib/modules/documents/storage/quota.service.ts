import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import { DEFAULT_MAX_FILE_BYTES, StorageError } from "@/lib/core/storage";

/**
 * Company storage accounting (PRD #29 §141-§153, §330).
 *
 * Two rows per company, deliberately separate:
 *
 *   CompanyStorageQuota  configuration — what they are allowed
 *   CompanyStorageUsage  a projection — what they are actually storing
 *
 * The projection exists so a quota check is one indexed read rather than a sum
 * over every document, and it is maintained transactionally with the upload
 * that changes it (PRD #29 §147, §148).
 *
 * Usage counts original uploaded bytes only. Derived previews are
 * infrastructure cost, not something a customer should find on their bill
 * (PRD #29 §242, §243).
 */

export type StorageQuota = {
  maxStorageBytes: bigint | null;
  maxSingleFileBytes: bigint;
};

export type StorageUsage = {
  usedBytes: bigint;
  fileCount: number;
  /** Bytes promised to uploads that are open but not yet complete (§150). */
  reservedBytes: bigint;
};

/**
 * The company's limits, with the product default when no row exists.
 *
 * A null total is not "unlimited" so much as "no ceiling has been set" —
 * deployment policy decides, and usage is measured either way
 * (PRD #29 §145, §151).
 */
export async function companyQuota(companyId: string): Promise<StorageQuota> {
  const row = await prisma.companyStorageQuota.findUnique({ where: { companyId } });
  if (!row) {
    return { maxStorageBytes: null, maxSingleFileBytes: BigInt(DEFAULT_MAX_FILE_BYTES) };
  }
  return { maxStorageBytes: row.maxStorageBytes, maxSingleFileBytes: row.maxSingleFileBytes };
}

export async function companyUsage(companyId: string): Promise<StorageUsage> {
  const [usage, reserved] = await Promise.all([
    prisma.companyStorageUsage.findUnique({ where: { companyId } }),
    sumReservedBytes(prisma, companyId),
  ]);

  return {
    usedBytes: usage?.usedBytes ?? BigInt(0),
    fileCount: usage?.fileCount ?? 0,
    reservedBytes: reserved,
  };
}

/** The largest single file this company may upload (PRD #29 §26, §144). */
export async function maxSingleFileBytes(companyId: string): Promise<number> {
  const quota = await companyQuota(companyId);
  // Never above the product default, whatever a row says: the deployment may
  // lower the ceiling, not raise it (PRD #29 §26, §440).
  return Math.min(Number(quota.maxSingleFileBytes), DEFAULT_MAX_FILE_BYTES);
}

async function sumReservedBytes(
  client: Prisma.TransactionClient | typeof prisma,
  companyId: string,
): Promise<bigint> {
  const result = await client.documentUploadSession.aggregate({
    where: { companyId, status: { in: ["CREATED", "UPLOADING"] }, expiresAt: { gt: new Date() } },
    _sum: { reservedBytes: true },
  });
  return result._sum.reservedBytes ?? BigInt(0);
}

/**
 * Refuses an upload that would take the company past its ceiling
 * (PRD #29 §149, §150, §152).
 *
 *   used + reserved + incoming <= quota
 *
 * The reservation term is what makes concurrent uploads safe: two browsers
 * that both check against the same headroom would both pass without it. The
 * usage row is locked for the duration so the check and the reservation cannot
 * interleave (PRD #29 §149).
 */
export async function assertQuotaAllows(
  tx: Prisma.TransactionClient,
  companyId: string,
  incomingBytes: number,
): Promise<void> {
  const quota = await companyQuota(companyId);

  if (BigInt(incomingBytes) > quota.maxSingleFileBytes) {
    throw new StorageError(
      "FILE_TOO_LARGE",
      `Files must be ${Math.round(Number(quota.maxSingleFileBytes) / (1024 * 1024))} MB or smaller.`,
    );
  }

  // No hard ceiling configured: usage is still measured and displayed, there
  // is simply nothing to refuse against (PRD #29 §145, §151).
  if (quota.maxStorageBytes === null) return;

  await lockUsageRow(tx, companyId);

  const usage = await tx.companyStorageUsage.findUnique({ where: { companyId } });
  const reserved = await sumReservedBytes(tx, companyId);
  const projected = (usage?.usedBytes ?? BigInt(0)) + reserved + BigInt(incomingBytes);

  if (projected > quota.maxStorageBytes) {
    throw new StorageError("STORAGE_QUOTA_EXCEEDED");
  }
}

/**
 * Takes the row lock that serialises concurrent quota checks.
 *
 * `ON CONFLICT DO UPDATE` rather than `DO NOTHING`, because a no-op insert
 * does not lock the existing row and the whole point here is to be second in
 * the queue when two uploads race.
 */
async function lockUsageRow(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "company_storage_usage" ("companyId", "usedBytes", "fileCount", "updatedAt")
    VALUES (${companyId}, 0, 0, NOW())
    ON CONFLICT ("companyId") DO UPDATE SET "updatedAt" = "company_storage_usage"."updatedAt"
  `;
  await tx.$queryRaw`SELECT "usedBytes" FROM "company_storage_usage" WHERE "companyId" = ${companyId} FOR UPDATE`;
}

/** Adds a verified object to the projection (PRD #29 §148). */
export async function addUsage(
  tx: Prisma.TransactionClient,
  companyId: string,
  bytes: number | bigint,
): Promise<void> {
  await tx.companyStorageUsage.upsert({
    where: { companyId },
    create: { companyId, usedBytes: BigInt(bytes), fileCount: 1 },
    update: { usedBytes: { increment: BigInt(bytes) }, fileCount: { increment: 1 } },
  });
}

/**
 * Removes physically deleted bytes from the projection (PRD #29 §148).
 *
 * Called on physical deletion only. Archiving keeps the object and therefore
 * keeps the bytes (PRD #29 §135, §139).
 */
export async function removeUsage(
  tx: Prisma.TransactionClient,
  companyId: string,
  bytes: number | bigint,
): Promise<void> {
  const current = await tx.companyStorageUsage.findUnique({ where: { companyId } });
  if (!current) return;

  // Clamped, because a projection that has drifted should not go negative and
  // trip the check constraint on the way past zero.
  const next = current.usedBytes - BigInt(bytes);
  await tx.companyStorageUsage.update({
    where: { companyId },
    data: {
      usedBytes: next < BigInt(0) ? BigInt(0) : next,
      fileCount: current.fileCount > 0 ? current.fileCount - 1 : 0,
    },
  });
}

/**
 * Recomputes the projection from the documents themselves.
 *
 * The reconciliation PRD #35 §238 asks for: a projection can drift, and the
 * ledger it projects is still right.
 */
export async function recalculateUsage(companyId: string): Promise<StorageUsage> {
  const aggregate = await prisma.document.aggregate({
    where: { companyId, storageKey: { not: null }, storageStatus: { not: "REJECTED" } },
    _sum: { sizeBytes: true },
    _count: true,
  });

  const usedBytes = aggregate._sum.sizeBytes ?? BigInt(0);
  const fileCount = aggregate._count;

  await prisma.companyStorageUsage.upsert({
    where: { companyId },
    create: { companyId, usedBytes, fileCount },
    update: { usedBytes, fileCount },
  });

  return { usedBytes, fileCount, reservedBytes: await sumReservedBytes(prisma, companyId) };
}
