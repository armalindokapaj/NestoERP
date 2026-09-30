import { z } from "zod";

import { apiError, apiOk, withContext } from "@/lib/api/respond";
import { listDevices } from "@/lib/modules/security/security.service";

const querySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(["ACTIVE", "STALE", "REVOKED", "BLOCKED"]).optional(),
  platform: z.enum(["IOS", "ANDROID"]).optional(),
  companyId: z.string().max(64).optional(),
  compliance: z.enum(["COMPLIANT", "WARNING", "NON_COMPLIANT", "BLOCKED", "UNKNOWN"]).optional(),
  appVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  page: z.coerce.number().int().min(0).max(1000).optional(),
});

/**
 * Mobile devices in the administrator's scope (MOB-11 §23-§28). Needs
 * `security.devices.read`; in the Group workspace it is the union of the
 * companies the person holds it in, and nothing outside them.
 */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!parsed.success) return apiError("VALIDATION_ERROR", "Invalid filter.");
      const { page = 0, ...filters } = parsed.data;
      return apiOk({ data: await listDevices(context, filters, { take: 50, skip: page * 50 }) });
    },
    { group: "read" },
  );
}
