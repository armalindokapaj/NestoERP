import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { publishPricingVersionSchema } from "@/lib/modules/pricing/pricing.schema";
import { publishPricingVersion } from "@/lib/modules/pricing/pricing.service";

export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  return withPlatformContext(async (context) => {
    const { versionId } = await params;
    const input = publishPricingVersionSchema.parse(await readJson(request));
    return apiOk({ data: await publishPricingVersion(context, versionId, input.reason) });
  });
}
