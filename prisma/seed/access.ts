/**
 * Seeds the access configuration: roles, permissions, modules, the role ×
 * permission grants and the role × module matrix (PRD #9 §14–§21).
 *
 * The work lives in `lib/core/access/access-sync.service.ts`, because every
 * environment needs it and production must not run the demo seed to get it
 * (PRD #38 §19). The seed does not hold a second interpretation of the matrix.
 */
import type { PrismaClient } from "@prisma/client";

import { syncAccessConfiguration } from "../../lib/core/access/access-sync.service";

export function seedAccessConfiguration(prisma: PrismaClient) {
  return syncAccessConfiguration(prisma);
}
