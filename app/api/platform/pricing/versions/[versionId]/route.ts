import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { updatePricingVersionSchema } from "@/lib/modules/pricing/pricing.schema";
import { updatePricingDraft } from "@/lib/modules/pricing/pricing.service";

export async function PATCH(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  return withPlatformContext(async (context) => {
    const { versionId } = await params;
    const input = updatePricingVersionSchema.parse(await readJson(request));
    return apiOk({ data: await updatePricingDraft(context, versionId, input.config, new Date(input.effectiveFrom)) });
  });
}
