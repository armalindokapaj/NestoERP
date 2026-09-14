import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { entityRefSchema } from "@/lib/modules/productivity/productivity.schema";
import { recordRecentAccess } from "@/lib/modules/productivity/recent-work.service";

/** POST — this member opened a record; recorded only if they can open it, at most every ten minutes (PRD #45 §99, §100, §162). */
export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = entityRefSchema.parse(await readJson(request));
    return apiOk({ data: { recorded: await recordRecentAccess(context, input.entityType, input.entityId) } });
  });
}
