import { NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { calculatePricingRequestSchema } from "@/lib/modules/pricing/pricing.schema";
import { assertPublicMutationOrigin, pricingApiError, publicRequestSubject, rateLimitResponse } from "@/lib/modules/pricing/pricing.http";
import { calculateAuthoritativePricing } from "@/lib/modules/pricing/pricing.service";

export async function POST(request: Request) {
  try {
    const limit = checkRateLimit("PUBLIC_PRICING", await publicRequestSubject(request));
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);
    const parsed = calculatePricingRequestSchema.parse(await request.json());
    const { persistQuote, ...configuration } = parsed;
    if (persistQuote) assertPublicMutationOrigin(request);
    const quote = await calculateAuthoritativePricing(configuration, { persistQuote });
    return NextResponse.json({ data: quote }, { status: persistQuote ? 201 : 200 });
  } catch (error) {
    return pricingApiError(error);
  }
}
