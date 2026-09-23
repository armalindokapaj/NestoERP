import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { addFavoriteForWorkspace } from "@/lib/modules/productivity/favorites.service";
import { listMyWork } from "@/lib/modules/productivity/my-work.service";
import { entityRefSchema, myWorkQuerySchema, myWorkRange } from "@/lib/modules/productivity/productivity.schema";

/** GET — the favorites tab of My Work (Fast Re-entry §90). Group workspace: `read`; user-global (§161). */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const input = myWorkQuerySchema.parse({ ...Object.fromEntries(new URL(request.url).searchParams), tab: "favorites" });
      return apiOk({ data: await listMyWork(context, { ...input, ...myWorkRange(input) }) });
    },
    { group: "read" },
  );
}

/**
 * POST — star a record the person can open now (Fast Re-entry §92-§94, §199).
 *
 * Group workspace: `any`. The body names only the record; the module and the
 * company come from the server's own resolution, never from the client
 * (§93, §188), and a record they cannot open is simply not found (§103).
 */
export async function POST(request: Request) {
  return withContext(
    async (context) => {
      const input = entityRefSchema.parse(await readJson(request));
      return apiOk({ data: await addFavoriteForWorkspace(context, input) }, { status: 201 });
    },
    { group: "any" },
  );
}
