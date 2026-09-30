import { z } from "zod";

import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { recordAuthEvent } from "@/lib/auth/events";
import { listOwnSecurityEvents } from "@/lib/modules/security/security.service";

/** The signed-in person's own recent security history (MOB-11 §113). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await listOwnSecurityEvents(context) }), { group: "any" });
}

const eventSchema = z.object({ type: z.enum(["BIOMETRIC_ENABLED", "BIOMETRIC_DISABLED"]) });

/**
 * The app records that the person turned app lock on or off (MOB-11 §111).
 * Only these two, only about the caller, and nothing the client says changes
 * what the server enforces.
 */
export async function POST(request: Request) {
  return withContext(
    async (context) => {
      const parsed = eventSchema.safeParse(await readJson(request));
      if (!parsed.success) return apiError("VALIDATION_ERROR", "Invalid event.");
      await recordAuthEvent({ type: parsed.data.type, userId: context.userId, companyId: context.companyId, sessionId: context.sessionId });
      return apiOk({ data: { recorded: true } });
    },
    { group: "any", device: "ignore" },
  );
}
