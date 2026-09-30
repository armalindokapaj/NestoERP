import { z } from "zod";

import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { documentOfflineStatus } from "@/lib/modules/documents/versions/offline.service";

const bodySchema = z.object({ documentIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).min(1).max(100) });

/**
 * POST /api/sync/documents — where each downloaded document stands now: its current
 * version, and whether it can still be fetched (MOB-09 §15-§18). A document the
 * caller can no longer open comes back as `null`, never as an error about it.
 */
export async function POST(request: Request) {
  return withContext(async (context) => {
    const parsed = bodySchema.safeParse(await readJson(request).catch(() => ({})));
    if (!parsed.success) return apiError("VALIDATION_ERROR", "That request is not valid.");
    const statuses = await Promise.all(parsed.data.documentIds.map((id) => documentOfflineStatus(context, id).catch(() => null)));
    return apiOk({ data: parsed.data.documentIds.map((id, index) => ({ documentId: id, status: statuses[index] })) });
  });
}
