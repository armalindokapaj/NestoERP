import type { PrismaClient } from "@prisma/client";

import { DEFAULT_MAX_FILE_BYTES } from "../../lib/core/storage";

/**
 * Storage quotas for the demo companies (PRD #29 §144, §145).
 *
 * Every company gets a row, so the ceiling is a stated policy rather than an
 * implicit default buried in code. `maxStorageBytes` stays null — no hard
 * total is configured, which is exactly what §145 describes when the business
 * has not set one. Usage is still measured and shown.
 */
export async function seedStorageQuotas(prisma: PrismaClient): Promise<void> {
  const companies = await prisma.company.findMany({ select: { id: true } });

  for (const company of companies) {
    await prisma.companyStorageQuota.upsert({
      where: { companyId: company.id },
      update: {},
      create: {
        companyId: company.id,
        maxStorageBytes: null,
        maxSingleFileBytes: BigInt(DEFAULT_MAX_FILE_BYTES),
      },
    });
  }
}
