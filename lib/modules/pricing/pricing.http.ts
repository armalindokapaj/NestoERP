import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AccessError } from "@/lib/access/guards";
import { hashSubject } from "@/lib/core/security/rate-limit";

export async function publicRequestSubject(request: Request): Promise<string> {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "anonymous";
  return hashSubject(address);
}

export function assertPublicMutationOrigin(request: Request): void {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") throw new AccessError("FORBIDDEN", "Cross-site requests are not accepted.");
  const origin = request.headers.get("origin");
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestHost = forwardedHost || request.headers.get("host") || new URL(request.url).host;
  if (origin && new URL(origin).host !== requestHost) {
    throw new AccessError("FORBIDDEN", "Cross-site requests are not accepted.");
  }
}

export function pricingApiError(error: unknown): Response {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Some of the supplied values are not valid.", details: error.flatten().fieldErrors } }, { status: 422 });
  }
  if (error instanceof AccessError) {
    return NextResponse.json({ error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } }, { status: error.status });
  }
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Pricing is temporarily unavailable. Please try again." } }, { status: 500 });
}

export function rateLimitResponse(retryAfterSeconds: number): Response {
  return NextResponse.json(
    { error: { code: "RATE_LIMITED", message: "Too many pricing requests. Please try again shortly." } },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}
