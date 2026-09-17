import type { ParentGroupStatus } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { prisma } from "@/lib/database/prisma";

/**
 * The Platform Admin's view of the platform (E-06 §20, §128).
 *
 * Parent groups and their companies, as configuration — never their business
 * records. Test fixture groups exist only for the automated suites and are not
 * part of anybody's platform (E-06 §45).
 */

export type PlatformGroupSummaryDTO = {
  id: string;
  slug: string;
  name: string;
  country: string | null;
  status: ParentGroupStatus;
  companyCount: number;
  activatedAt: string | null;
};

export async function listParentGroups(context: PlatformContext): Promise<PlatformGroupSummaryDTO[]> {
  if (!canPlatform(context, "platform.group.view")) throw new AccessError("FORBIDDEN");

  const groups = await prisma.parentGroup.findMany({
    where: { isTestFixture: false },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      country: true,
      status: true,
      activatedAt: true,
      _count: { select: { companies: true } },
    },
  });

  return groups.map((group) => ({
    id: group.id,
    slug: group.slug,
    name: group.name,
    country: group.country,
    status: group.status,
    companyCount: group._count.companies,
    activatedAt: group.activatedAt?.toISOString() ?? null,
  }));
}
