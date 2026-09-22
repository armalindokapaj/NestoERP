import { NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { assertPublicMutationOrigin, pricingApiError, publicRequestSubject, rateLimitResponse } from "@/lib/modules/pricing/pricing.http";
import { pricingLeadSchema } from "@/lib/modules/pricing/pricing.schema";
import { submitPricingLead } from "@/lib/modules/pricing/pricing.service";

export async function POST(request: Request) {
  try {
    assertPublicMutationOrigin(request);
    const limit = checkRateLimit("PUBLIC_PRICING_LEAD", await publicRequestSubject(request));
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);
    const input = pricingLeadSchema.parse(await request.json());
    if (input.website) return NextResponse.json({ data: { accepted: true } }, { status: 202 });
    return NextResponse.json({ data: await submitPricingLead(input) }, { status: 201 });
  } catch (error) {
    return pricingApiError(error);
  }
}
