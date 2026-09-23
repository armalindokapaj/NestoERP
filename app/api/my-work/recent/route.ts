import { apiOk, withContext } from "@/lib/api/respond";
import { clearRecentWorkForWorkspace } from "@/lib/modules/productivity/recent-work.service";
import { listMyWork } from "@/lib/modules/productivity/my-work.service";
import { myWorkQuerySchema, myWorkRange } from "@/lib/modules/productivity/productivity.schema";

/** GET — the recent tab of My Work (Fast Re-entry §90). Group workspace: `read`; user-global (§161). */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const input = myWorkQuerySchema.parse({ ...Object.fromEntries(new URL(request.url).searchParams), tab: "recent" });
      return apiOk({ data: await listMyWork(context, { ...input, ...myWorkRange(input) }) });
    },
    { group: "read" },
  );
}

/** DELETE — clear the person's own recent work; favorites are untouched (Fast Re-entry §79, §218). Group workspace: `any`. */
export async function DELETE() {
  return withContext(async (context) => apiOk({ data: { removed: await clearRecentWorkForWorkspace(context) } }), { group: "any" });
}
