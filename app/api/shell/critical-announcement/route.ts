import { apiError, apiOk, withContext } from "@/lib/api/respond";
import { criticalAnnouncementBanner } from "@/lib/modules/announcements/announcement.service";
import { resolveShellCore } from "@/lib/workspace/shell-core";
import { settleSlot } from "@/lib/workspace/shell-slots";

/**
 * GET /api/shell/critical-announcement — the one critical banner again, for
 * the banner slot's Retry only (NAV-02 API-02, SHELL-03). The same audience
 * rules as the streamed read, with no user or member override (V03). An empty
 * answer is `banner: null`; a failure is an error, never an empty answer.
 */
export async function GET() {
  return withContext(
    async (session) => {
      const [core, banner] = await Promise.all([resolveShellCore(session), settleSlot("banner", () => criticalAnnouncementBanner(session), "retry")]);
      if (!banner.ok) return apiError("INTERNAL_ERROR");
      const response = apiOk({ data: { contextKey: core.contextKey, banner: banner.data } });
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    },
    { group: "any" },
  );
}
