import { apiOk, withContext } from "@/lib/api/respond";
import { listActionItems } from "@/lib/modules/meetings/meeting.actions";
import { actionListQuerySchema } from "@/lib/modules/meetings/meeting.schema";

/** GET /api/meetings/actions — action items across the meetings this reader can open; their own by default. */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const query = actionListQuerySchema.parse({
      mine: params.get("mine") ?? undefined,
      status: params.get("status") ?? undefined,
      projectId: params.get("projectId") ?? undefined,
      page: params.get("page") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    return apiOk(await listActionItems(context, query));
  });
}
