import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { createPricingVersionSchema } from "@/lib/modules/pricing/pricing.schema";
import { createPricingDraft, getPricingAdministration } from "@/lib/modules/pricing/pricing.service";

export async function GET() {
  return withPlatformContext(async (context) => apiOk({ data: await getPricingAdministration(context) }));
}

export async function POST(request: Request) {
  return withPlatformContext(async (context) => {
    const input = createPricingVersionSchema.parse(await readJson(request));
    return apiOk({ data: await createPricingDraft(context, input) }, { status: 201 });
  });
}
