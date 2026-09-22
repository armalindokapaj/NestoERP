import { NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { pricingApiError, publicRequestSubject, rateLimitResponse } from "@/lib/modules/pricing/pricing.http";
import { getPublicPricingConfig } from "@/lib/modules/pricing/pricing.service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const limit = checkRateLimit("PUBLIC_PRICING", await publicRequestSubject(request));
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);
    return NextResponse.json({ data: await getPublicPricingConfig() }, { headers: { "cache-control": "public, max-age=60, s-maxage=300" } });
  } catch (error) {
    return pricingApiError(error);
  }
}
