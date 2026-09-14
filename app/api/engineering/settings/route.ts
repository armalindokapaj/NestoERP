import { assertPermission } from "@/lib/access/guards";
import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { engineeringSettingsSchema } from "@/lib/modules/engineering/engineering.schema";
import { resolveEngineeringSettings, updateEngineeringSettings } from "@/lib/modules/engineering/engineering.settings";

/** GET — the company's engineering defaults (PRD #46 §279). */
export async function GET() {
  return withContext(async (context) => {
    assertPermission(context, "engineering.settings.manage");
    return apiOk({ data: await resolveEngineeringSettings(context.companyId) });
  });
}

/** PUT — change them (PRD #46 §279). */
export async function PUT(request: Request) {
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = engineeringSettingsSchema.parse(await readJson(request));
    return apiOk({ data: await updateEngineeringSettings(context, input) });
  });
}
