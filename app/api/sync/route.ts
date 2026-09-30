import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { AccessError } from "@/lib/access/guards";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { batchRequestSchema } from "@/lib/core/sync/protocol.schema";
import { processSyncBatch } from "@/lib/core/sync/sync.service";

/**
 * POST /api/sync — replay the changes a device made offline (MOB-09 §146-§148).
 *
 * Not a bypass: the caller is authenticated and authorised like any request,
 * and each change is handed to the module that owns it, which calls its own
 * service. The answer names every operation's outcome, so one refusal never
 * hides the others.
 */
export async function POST(request: Request) {
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) throw new AccessError("CONFLICT", "RATE_LIMITED");
    const parsed = batchRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("VALIDATION_ERROR", "That sync request is not valid.");
    return apiOk({ data: await processSyncBatch(context, parsed.data) });
  });
}
