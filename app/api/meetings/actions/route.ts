import { apiOk, withContext } from "@/lib/api/respond";
import { actionListQuerySchema } from "@/lib/modules/meetings/meeting.schema";
import { listActionItemsForWorkspace } from "@/lib/modules/meetings/meeting.workspace";

/**
 * GET /api/meetings/actions — action items across the meetings this reader can open; their own by default.
 * In the Group workspace: across every company they may open Meetings in, each row naming its company (Workspace Context §34).
 */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const params = new URL(request.url).searchParams;
      const query = actionListQuerySchema.parse({
        mine: params.get("mine") ?? undefined,
        status: params.get("status") ?? undefined,
        projectId: params.get("projectId") ?? undefined,
        company: params.get("company") ?? undefined,
        page: params.get("page") ?? undefined,
        limit: params.get("limit") ?? undefined,
      });
      return apiOk(await listActionItemsForWorkspace(context, query));
    },
    { group: "read" },
  );
}
