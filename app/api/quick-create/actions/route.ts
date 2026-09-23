import { apiOk, withContext } from "@/lib/api/respond";
import { quickCreateMenuQuerySchema } from "@/lib/modules/quick-create/quick-create.schema";
import { listAvailableActions } from "@/lib/modules/quick-create/quick-create.service";

/**
 * GET — the create actions this person may launch here, filtered on the server
 * (Quick Create §87-§90), with the current page's record as safe context when
 * it is one (§21). Group workspace: `read` — each action names the companies
 * where it may be created, and only those (§17).
 */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const input = quickCreateMenuQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
      return apiOk({ data: await listAvailableActions(context, input) });
    },
    { group: "read" },
  );
}
