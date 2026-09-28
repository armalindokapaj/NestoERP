import { NextResponse } from "next/server";

import { logger, serialiseError } from "@/lib/core/observability/logger";
import { checkRateLimit, type RateLimitCategory } from "@/lib/core/security/rate-limit";
import { publicRequestSubject } from "@/lib/modules/pricing/pricing.http";

/**
 * The anonymous 3D routes' shared behaviour (ADM-04A §10, §12): per-address
 * limits, no caching anywhere, never indexed, and one generic answer for every
 * failure so no response reveals which organization or experience exists.
 */

export const PUBLIC_NO_STORE = {
  "Cache-Control": "no-store, private",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
} as const;

export async function withPublic3D(request: Request, category: RateLimitCategory, run: () => Promise<Response>): Promise<Response> {
  try {
    const limit = checkRateLimit(category, await publicRequestSubject(request));
    if (!limit.allowed) {
      return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests. Please try again shortly." } }, { status: 429, headers: { ...PUBLIC_NO_STORE, "Retry-After": String(limit.retryAfterSeconds) } });
    }
    return await run();
  } catch (error) {
    logger.error("project3d.public.failed", serialiseError(error));
    return NextResponse.json({ error: { code: "UNAVAILABLE", message: "This 3D experience is not available." } }, { status: 503, headers: PUBLIC_NO_STORE });
  }
}

export function publicJson(data: unknown, status = 200): Response {
  return NextResponse.json({ data }, { status, headers: PUBLIC_NO_STORE });
}
