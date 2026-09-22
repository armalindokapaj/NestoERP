import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { updatePricingPromotionSchema } from "@/lib/modules/pricing/pricing.schema";
import { updatePricingPromotion } from "@/lib/modules/pricing/pricing.service";

export async function PATCH(request: Request, { params }: { params: Promise<{ promotionId: string }> }) {
  return withPlatformContext(async (context) => {
    const { promotionId } = await params;
    const input = updatePricingPromotionSchema.parse(await readJson(request));
    return apiOk({ data: await updatePricingPromotion(context, promotionId, {
      ...input,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
    }) });
  });
}
