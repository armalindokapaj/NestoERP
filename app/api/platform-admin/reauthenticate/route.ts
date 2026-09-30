import { headers } from "next/headers";

import { apiError, apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { hasRecentAuthentication, reauthenticateWithPassword } from "@/lib/auth/recent-auth";
import { clientAddress, userAgentOf } from "@/lib/core/security/throttle";

/** Has this Platform Admin session proved itself recently enough for a sensitive action? (MOB-11 §47, §48) */
export async function GET() {
  return withPlatformContext(async (context) => apiOk({ data: { recent: await hasRecentAuthentication(context) } }));
}

/** The Platform Admin confirms their password again. The same server-side rule as everyone else's. */
export async function POST(request: Request) {
  return withPlatformContext(async (context) => {
    const body = await readJson(request);
    if (typeof body.password !== "string" || body.password.length === 0 || body.password.length > 256) return apiError("VALIDATION_ERROR", "Enter your password.");
    const requestHeaders = await headers();
    await reauthenticateWithPassword(context, body.password, { ipAddress: clientAddress(requestHeaders), userAgent: userAgentOf(requestHeaders) });
    return apiOk({ data: { reauthenticated: true } });
  });
}
