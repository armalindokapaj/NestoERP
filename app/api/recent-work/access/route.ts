import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { entityRefSchema } from "@/lib/modules/productivity/productivity.schema";
import { recordRecentAccessForWorkspace } from "@/lib/modules/productivity/recent-work.service";

/**
 * POST — this member opened a record; recorded only if they can open it, at most every ten minutes (PRD #45 §99, §100, §162).
 *
 * Group workspace: `any`. Noting an open is the person's own light write with
 * no company to get wrong: the record decides it. It is kept for the person's
 * membership in the company the record lives in, found among their own
 * memberships, and not at all when they cannot open it in any of them
 * (Workspace Context §43).
 */
export async function POST(request: Request) {
  return withContext(
    async (context) => {
      const input = entityRefSchema.parse(await readJson(request));
      return apiOk({ data: { recorded: await recordRecentAccessForWorkspace(context, input.entityType, input.entityId) } });
    },
    { group: "any" },
  );
}
