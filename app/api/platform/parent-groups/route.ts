import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { createParentGroup } from "@/lib/modules/platform/platform-implementation.service";
import { createParentGroupSchema } from "@/lib/modules/platform/platform.schema";
import { listParentGroups } from "@/lib/modules/platform/platform.service";

/**
 * GET  /api/platform/parent-groups — every group on the platform (E-06 §86).
 * POST /api/platform/parent-groups — a new group, implementing, with its departments.
 *
 * Platform-scoped: a company session is refused whoever holds it (§116).
 */
export async function GET() {
  return withPlatformContext(async (context) => apiOk({ data: await listParentGroups(context) }));
}

export async function POST(request: Request) {
  return withPlatformContext(async (context) => {
    const input = createParentGroupSchema.parse(await readJson(request));
    return apiOk({ data: await createParentGroup(context, input) }, { status: 201 });
  });
}
