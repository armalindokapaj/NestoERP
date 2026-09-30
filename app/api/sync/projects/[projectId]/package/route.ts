import { z } from "zod";

import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { PACKAGE_KINDS, buildProjectPackage, type KnownTokens } from "@/lib/core/sync/package.service";

type Params = { params: Promise<{ projectId: string }> };

const bodySchema = z.object({
  known: z.object(Object.fromEntries(PACKAGE_KINDS.map((kind) => [kind, z.record(z.string(), z.string()).optional()]))).partial().default({}),
});

/**
 * POST /api/sync/projects/:id/package — a Project's offline package, or only what
 * differs from the tokens the device already holds (MOB-09 §9, §71).
 * A POST because the tokens are a body; it reads, and changes nothing.
 */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const parsed = bodySchema.safeParse(await readJson(request).catch(() => ({})));
    if (!parsed.success) return apiError("VALIDATION_ERROR", "That request is not valid.");
    return apiOk({ data: await buildProjectPackage(context, projectId, parsed.data.known as KnownTokens) });
  });
}
