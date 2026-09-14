import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { productivitySettingsSchema } from "@/lib/modules/productivity/productivity.schema";
import { resolveProductivitySettings, updateProductivitySettings } from "@/lib/modules/productivity/productivity.settings";

/** GET — the company's switches for announcements, favorites and recent work (PRD #45 §247). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await resolveProductivitySettings(context.companyId) }));
}

/** PUT — change them (the company's announcement authority, audited). */
export async function PUT(request: Request) {
  return withContext(async (context) => {
    const input = productivitySettingsSchema.parse(await readJson(request));
    return apiOk({ data: await updateProductivitySettings(context, input) });
  });
}
