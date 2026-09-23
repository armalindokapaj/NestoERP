import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { entityRefSchema } from "@/lib/modules/productivity/productivity.schema";
import { recordRecentAccessForWorkspace } from "@/lib/modules/productivity/recent-work.service";

/**
 * POST — the client-side fallback for "I opened this record" (Fast Re-entry
 * §96-§98, §198). Record pages note the open on the server themselves; this is
 * for a record that opens in a drawer. Still authorised: nothing is kept for a
 * record the person cannot open (§95, §104). Group workspace: `any`.
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
