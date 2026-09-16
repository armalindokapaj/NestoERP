import { apiError, apiOk, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { globalSearch } from "@/lib/core/search/search.service";

/**
 * GET /api/search — cross-module discovery (PRD #26 §166, §169).
 *
 * Rate limited because search is comparatively expensive and is the natural
 * surface for enumeration attempts (PRD #26 §218, §221).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const limit = checkRateLimit("SEARCH", context.membershipId);
    if (!limit.allowed) {
      return apiError("VALIDATION_ERROR", "Too many searches. Try again shortly.");
    }

    const params = new URL(request.url).searchParams;
    const modules = params.getAll("module");

    return apiOk(
      await globalSearch(context, params.get("q") ?? "", {
        moduleKeys: modules.length > 0 ? modules : undefined,
        // Passed as written; the service clamps both, so no caller can widen them (PRD #47 §175).
        limitPerProvider: params.get("limitPerProvider"),
        totalLimit: params.get("limit"),
      }),
    );
  });
}
