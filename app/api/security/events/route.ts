import { z } from "zod";

import { apiError, apiOk, withContext } from "@/lib/api/respond";
import { listSecurityEvents } from "@/lib/modules/security/security.service";

const querySchema = z.object({ type: z.string().regex(/^[A-Z_]{3,40}$/).optional() });

/** Security events for the people in the administrator's scope — never secrets, never other groups (MOB-11 §113). */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!parsed.success) return apiError("VALIDATION_ERROR", "Invalid filter.");
      return apiOk({ data: await listSecurityEvents(context, { type: parsed.data.type as never }) });
    },
    { group: "read" },
  );
}
