import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { quickCreateLaunchSchema } from "@/lib/modules/quick-create/quick-create.schema";
import { resolveLaunch } from "@/lib/modules/quick-create/quick-create.service";

/**
 * POST — resolve one action into its canonical create route (Quick Create §93-§98).
 * Nothing is created here; the permission, the company and every prefilled id
 * are checked again now, and the create page checks them once more (§62).
 * Group workspace: `any` — it writes nothing, and names the company the browser
 * must enter before the create page opens (§69).
 */
export async function POST(request: Request) {
  return withContext(
    async (context) => {
      const input = quickCreateLaunchSchema.parse(await readJson(request));
      return apiOk({ data: await resolveLaunch(context, input) });
    },
    { group: "any" },
  );
}
