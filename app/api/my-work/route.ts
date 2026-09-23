import { apiOk, withContext } from "@/lib/api/respond";
import { listMyWork } from "@/lib/modules/productivity/my-work.service";
import { myWorkQuerySchema, myWorkRange } from "@/lib/modules/productivity/productivity.schema";

/**
 * GET — one tab of My Work: the person's own recent or favorite records they can
 * still open, filtered and cursor-paged (Fast Re-entry §90, §135, §196).
 *
 * Group workspace: `read`. My Work is user-global (§161): it reads the person's
 * own rows across every company of their group whatever the workspace, and a
 * company filter narrows the list without switching anything (§165, §166).
 */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const input = myWorkQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
      return apiOk({ data: await listMyWork(context, { ...input, ...myWorkRange(input) }) });
    },
    { group: "read" },
  );
}
