import { z } from "zod";

import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { getPolicyView, savePolicy } from "@/lib/modules/security/security.service";

/** The mobile policy levels the person may see, and what each Company is held to (MOB-11 §79, §80). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getPolicyView(context) }), { group: "read" });
}

const saveSchema = z.object({
  target: z.union([z.object({ scope: z.literal("PARENT_GROUP"), id: z.string().min(1).max(64) }), z.object({ scope: z.literal("COMPANY"), id: z.string().min(1).max(64) })]),
  settings: z.record(z.string(), z.unknown()),
});

/** Saves one level. Needs `security.policy.manage`, a recent sign-in, and is audited (MOB-11 §80, §185). */
export async function PUT(request: Request) {
  return withContext(
    async (context) => {
      const parsed = saveSchema.safeParse(await readJson(request));
      if (!parsed.success) return apiError("VALIDATION_ERROR", "Invalid policy.");
      return apiOk({ data: await savePolicy(context, parsed.data.target, parsed.data.settings) });
    },
    { group: "any" },
  );
}
