import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { hasRecentAuthentication, reauthenticateWithPassword } from "@/lib/auth/recent-auth";
import { clientAddress, userAgentOf } from "@/lib/core/security/throttle";
import { headers } from "next/headers";

/** GET /api/me/security/reauthenticate — has this session proved itself recently enough for a sensitive action? (MOB-11 §48) */
export async function GET() {
  return withContext(async (context) => apiOk({ data: { recent: await hasRecentAuthentication(context) } }), { group: "any" });
}

/** POST /api/me/security/reauthenticate — prove the password again before a sensitive action (MOB-11 §47-§49). */
export async function POST(request: Request) {
  return withContext(
    async (context) => {
      const body = await readJson(request);
      if (typeof body.password !== "string" || body.password.length === 0 || body.password.length > 256) return apiError("VALIDATION_ERROR", "Enter your password.");
      const requestHeaders = await headers();
      await reauthenticateWithPassword(context, body.password, { ipAddress: clientAddress(requestHeaders), userAgent: userAgentOf(requestHeaders) });
      return apiOk({ data: { reauthenticated: true } });
    },
    { group: "any" },
  );
}
