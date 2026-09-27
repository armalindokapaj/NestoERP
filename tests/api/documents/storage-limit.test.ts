import { afterAll, describe, expect, it } from "vitest";

import { DEFAULT_MAX_FILE_BYTES } from "@/lib/core/storage";
import type { StorageProvider } from "@/lib/core/storage/storage-provider";
import { setStorageProvider, storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { maxSingleFileBytes } from "@/lib/modules/documents/storage/quota.service";
import { prisma } from "@/tests/helpers";

/** A document is refused at the store's own per-file limit when that is lower (a Supabase bucket). */
describe("the single-file limit", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("follows the object store's limit when it is below the product default", async () => {
    const company = await prisma.company.findFirstOrThrow({ select: { id: true } });
    const local = storageProvider();
    const unlimited = await maxSingleFileBytes(company.id);
    expect(unlimited).toBeLessThanOrEqual(DEFAULT_MAX_FILE_BYTES);

    const limited = Object.assign(Object.create(Object.getPrototypeOf(local)) as StorageProvider, local, { maxObjectBytes: async () => 1024 * 1024 });
    setStorageProvider(limited);
    try {
      await expect(maxSingleFileBytes(company.id)).resolves.toBe(Math.min(unlimited, 1024 * 1024));
    } finally {
      setStorageProvider(local);
    }
  });
});
