import { assertPermission } from "@/lib/access/guards";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import * as quota from "./quota.service";
import type { CompanyStorageSummary } from "./storage.types";

/**
 * What a company is storing (PRD #29 §244, §245).
 *
 * Numbers only. Buckets, credentials and endpoints are deployment
 * configuration and never appear here — no company administrator configures
 * physical storage in V0.1 (PRD #29 §246, §398).
 */
export async function getCompanyStorageSummary(
  context: UserContext,
): Promise<CompanyStorageSummary> {
  assertPermission(context, "company.storage.view");

  const [limits, usage] = await Promise.all([
    quota.companyQuota(context.companyId),
    quota.companyUsage(context.companyId),
  ]);

  const maxStorageBytes = limits.maxStorageBytes === null ? null : Number(limits.maxStorageBytes);
  const usedBytes = Number(usage.usedBytes);

  return {
    usedBytes,
    fileCount: usage.fileCount,
    reservedBytes: Number(usage.reservedBytes),
    maxStorageBytes,
    maxSingleFileBytes: Number(limits.maxSingleFileBytes),
    // Null rather than zero when no ceiling is set: "0% of nothing" would be a
    // reassuring lie (PRD #29 §145).
    percentUsed:
      maxStorageBytes === null || maxStorageBytes === 0
        ? null
        : Math.min(100, Math.round((usedBytes / maxStorageBytes) * 100)),
  };
}

/**
 * The largest files in the company (PRD #29 §244).
 *
 * Scoped to the company, not to the reader's document access — this is a
 * storage-administration view held by `company.storage.view`, and it names
 * files rather than opening them. Nothing here links to content.
 */
export async function listLargestFiles(context: UserContext, take = 10) {
  assertPermission(context, "company.storage.view");

  const rows = await prisma.document.findMany({
    where: { companyId: context.companyId, storageKey: { not: null } },
    select: {
      id: true,
      name: true,
      extension: true,
      sizeBytes: true,
      storageStatus: true,
      createdAt: true,
    },
    orderBy: { sizeBytes: "desc" },
    take,
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    extension: row.extension,
    sizeBytes: row.sizeBytes === null ? 0 : Number(row.sizeBytes),
    storageStatus: row.storageStatus,
    createdAt: row.createdAt.toISOString(),
  }));
}
